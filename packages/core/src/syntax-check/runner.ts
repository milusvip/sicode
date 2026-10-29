/**
 * Runs the syntax check for one file.
 *
 * Kept apart from the plugin so the command table and the output parsing stay testable without a
 * live Effect runtime.
 */
export * as SyntaxCheckRunner from "./runner.js"

import { ChildProcess } from "effect/process"
import { Effect, Option } from "effect"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { which } from "../util/which.js"
import {
  extensionOf,
  parseBashOutput,
  parseBunOutput,
  parseClangOutput,
  parseJsonError,
  parsePythonOutput,
  type Diagnostic,
} from "../syntax-check.js"
import { PowerShellCheck } from "./powershell.js"

/**
 * Extensions `bun build --no-bundle` handles. Verified to report syntax errors only — imports
 * that do not resolve, css imports and missing files all pass silently, so a correct file is
 * never flagged. That property is the whole reason this checker is safe to run on every write.
 */
const SCRIPT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"])

/** `ast.parse` rather than `py_compile`: it type-checks the source without writing `__pycache__`. */
const PYTHON = new Set([".py"])

const SHELL = new Set([".sh", ".bash"])

/**
 * `clang++ -fsyntax-only` handles these. `.h` is left out on purpose: a plain-C header checked as
 * C++ misreports legal C, and a checker that flags correct code is worse than no checker.
 */
const CPP = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"])

/**
 * clang is routinely installed but not on PATH (the LLVM Windows installer, Homebrew on Apple
 * Silicon). Checked in order after `which` fails; the first that exists wins.
 */
const CLANG_FALLBACKS = [
  "C:\\Program Files\\LLVM\\bin\\clang++.exe",
  "/opt/homebrew/bin/clang++",
  "/usr/local/bin/clang++",
  "/usr/bin/clang++",
]

/**
 * Parsed in-process by the tree-sitter grammar this package already depends on, so there is no
 * executable to find and no process to start. PowerShell itself owns `.psd1` and `.psm1` too.
 */
const POWERSHELL = new Set([".ps1", ".psm1", ".psd1"])

const JSON_LIKE = new Set([".json"])

const PYTHON_PROGRAM =
  "import ast,io,sys; ast.parse(io.open(sys.argv[1],encoding='utf-8',errors='replace').read(), filename=sys.argv[1])"

export interface Input {
  /** Absolute path of the file that was just written. */
  readonly file: string
  readonly processes: AppProcess.Interface
  readonly fs: FSUtil.Interface
  readonly directory: string
  /** Extra directory searched for tools, matching how the formatter resolves them. */
  readonly bin: string
}

export type Outcome =
  | { readonly status: "clean" }
  | { readonly status: "errors"; readonly diagnostics: readonly Diagnostic[] }
  /** No checker covers this extension, or the tool it needs is not installed. */
  | { readonly status: "skipped"; readonly reason: string }

export const run = Effect.fn("SyntaxCheckRunner.run")(function* (input: Input) {
  const extension = extensionOf(input.file)
  if (extension === undefined) return { status: "skipped", reason: "no extension" } satisfies Outcome

  if (SCRIPT.has(extension)) return yield* script(input)
  if (PYTHON.has(extension)) return yield* python(input)
  if (SHELL.has(extension)) return yield* shell(input)
  if (CPP.has(extension)) return yield* cpp(input)
  if (POWERSHELL.has(extension)) return yield* powershell(input)
  if (JSON_LIKE.has(extension)) return yield* json(input)
  return { status: "skipped", reason: `no checker for ${extension}` } satisfies Outcome
})

const resolve = (input: Input, name: string) => which(name, undefined, input.bin) ?? undefined

/** First fallback path that exists on this machine, or undefined. */
const firstExisting = Effect.fnUntraced(function* (input: Input, candidates: readonly string[]) {
  for (const candidate of candidates) {
    if (yield* input.fs.existsSafe(candidate)) return candidate
  }
  return undefined
})

/**
 * A checker is an optimization; it must never hold up the edit it describes. Three seconds is
 * roughly ten times the measured cost of the slowest checker on this machine.
 */
const spawn = (input: Input, command: string, args: readonly string[]) =>
  input.processes
    .run(
      ChildProcess.make(command, [...args], {
        cwd: input.directory,
        extendEnv: true,
        stdin: "ignore",
        stdout: "ignore",
      }),
      { timeout: "3 seconds", maxErrorBytes: 64 * 1024 },
    )
    .pipe(Effect.option)

/** Turn an exit code plus stderr into an outcome, given the parser for that tool. */
const classify = (
  result: Option.Option<AppProcess.RunResult>,
  parse: (output: string) => Diagnostic[],
): Outcome => {
  if (Option.isNone(result)) return { status: "skipped", reason: "checker timed out" }
  if (result.value.exitCode === 0) return { status: "clean" }
  const diagnostics = parse(result.value.stderr.toString("utf8"))
  // Non-zero with unparseable output means the tool itself failed, not the file.
  return diagnostics.length === 0
    ? { status: "skipped", reason: `checker exited ${result.value.exitCode}` }
    : { status: "errors", diagnostics }
}

const script = Effect.fnUntraced(function* (input: Input) {
  const bun = resolve(input, "bun")
  if (bun === undefined) {
    // `node --check` is not a fallback: it parses TypeScript as JavaScript and would flag every
    // annotation. A host without bun gets no check rather than a wrong one.
    return { status: "skipped", reason: "bun not found" } satisfies Outcome
  }
  return classify(yield* spawn(input, bun, ["build", "--no-bundle", input.file]), (output) =>
    parseBunOutput(output, input.file),
  )
})

const python = Effect.fnUntraced(function* (input: Input) {
  const binary = resolve(input, "python") ?? resolve(input, "python3")
  if (binary === undefined) return { status: "skipped", reason: "python not found" } satisfies Outcome
  return classify(yield* spawn(input, binary, ["-c", PYTHON_PROGRAM, input.file]), (output) =>
    parsePythonOutput(output, input.file),
  )
})

const shell = Effect.fnUntraced(function* (input: Input) {
  const bash = resolve(input, "bash")
  if (bash === undefined) return { status: "skipped", reason: "bash not found" } satisfies Outcome
  return classify(yield* spawn(input, bash, ["-n", input.file]), (output) => parseBashOutput(output, input.file))
})

/**
 * Syntax only: no codegen, no linking. The error limit matches what the plugin reports anyway, so
 * a template explosion cannot flood the result, and the check stays fast.
 */
const cpp = Effect.fnUntraced(function* (input: Input) {
  const clang = resolve(input, "clang++") ?? (yield* firstExisting(input, CLANG_FALLBACKS))
  if (clang === undefined) return { status: "skipped", reason: "clang++ not found" } satisfies Outcome
  return classify(
    yield* spawn(input, clang, ["-fsyntax-only", "-ferror-limit=5", input.file]),
    (output) => parseClangOutput(output, input.file),
  )
})

/** JSON is parsed in-process: nothing to spawn, and the file is already on disk. */
const json = Effect.fnUntraced(function* (input: Input) {
  const text = yield* input.fs.readFileStringSafe(input.file).pipe(Effect.orElseSucceed(() => undefined))
  if (text === undefined) return { status: "skipped", reason: "unreadable" } satisfies Outcome
  try {
    JSON.parse(text)
    return { status: "clean" } satisfies Outcome
  } catch (error) {
    return { status: "errors", diagnostics: parseJsonError(error, text) } satisfies Outcome
  }
})

/** PowerShell is parsed in-process too, by the grammar this package already bundles. */
const powershell = Effect.fnUntraced(function* (input: Input) {
  if (!PowerShellCheck.available()) return { status: "skipped", reason: "no powershell grammar" } satisfies Outcome
  const text = yield* input.fs.readFileStringSafe(input.file).pipe(Effect.orElseSucceed(() => undefined))
  if (text === undefined) return { status: "skipped", reason: "unreadable" } satisfies Outcome
  const diagnostics = yield* PowerShellCheck.check(text).pipe(
    Effect.orElseSucceed(() => undefined),
  )
  // A grammar that fails to load is indistinguishable from a clean file unless it says so.
  if (diagnostics === undefined) return { status: "skipped", reason: "powershell grammar failed" } satisfies Outcome
  return diagnostics.length === 0
    ? ({ status: "clean" } satisfies Outcome)
    : ({ status: "errors", diagnostics } satisfies Outcome)
})
