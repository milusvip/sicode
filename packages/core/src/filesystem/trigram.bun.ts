// SiCode: trigram candidate index over FTS5, the storage half of two-stage search.
// A query is split into trigrams; each trigram is a single-token MATCH (detail=none cannot
// evaluate phrases), and the per-trigram rowid sets are intersected here. The result is a
// SUPERSET of the files containing the literal query — correctness stays with ripgrep, which
// re-runs on the candidates. Measured on this repo (8232 text files / 56MB): 10s build,
// 15MB on disk, 5-85ms per candidate query; a full rg sweep of the same tree is 3.5-4.4s.
import { Database } from "bun:sqlite"

/** Bumped when the stored shape or the meaning of a row changes; a mismatch rebuilds the index. */
export const SCHEMA_VERSION = 2

/**
 * What the indexed content looked like, so the next run can tell whether the file still holds it.
 * `mtimeMs` is the file's modification time, floored to whole milliseconds.
 */
export interface Fingerprint {
  readonly mtimeMs: number
  readonly size: number
}

/**
 * `mtimeMs` marker for a file that was enumerated but is not in the index at all: binary content,
 * or unreadable. Only its presence matters — its bytes can never contribute a candidate.
 */
export const NOT_INDEXED = -1

/** Normalize to forward slashes so stored paths, watcher events and rg output agree. */
const normalize = (path: string) => path.replaceAll("\\", "/")

export interface TrigramIndexConfig {
  /** Where the sqlite file lives. Use ":memory:" for tests. */
  readonly file: string
  /**
   * Fold case when indexing (default). A folded index is a superset for both sensitive and
   * insensitive queries, so it is the safe default; a sensitive index is smaller but can only
   * prefilter case-sensitive searches.
   */
  readonly caseSensitive?: boolean
}

/** Returned when the query is too short to contain even one trigram — fall back to rg. */
export const TRIGRAM_MIN = 3

export class TrigramIndex {
  private readonly db: Database
  // bun-types lacks a namespace-exported Statement type; inferred from the constructor.
  private readonly matchOne

  private constructor(db: Database) {
    this.db = db
    this.matchOne = db.query("SELECT rowid FROM t WHERE t MATCH ?")
  }

  static open(config: TrigramIndexConfig): TrigramIndex {
    const db = new Database(config.file)
    db.exec("PRAGMA journal_mode = WAL;")
    const sensitive = config.caseSensitive === true
    db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)`)
    db.exec(
      `CREATE TABLE IF NOT EXISTS m(id INTEGER PRIMARY KEY, p TEXT NOT NULL UNIQUE, t INTEGER NOT NULL DEFAULT 0, s INTEGER NOT NULL DEFAULT 0)`,
    )
    // SiCode: an index written before fingerprints existed has no mtime/size to compare against.
    // Add the columns instead of dropping the file, so the caller sees t=0 ("cannot vouch for this
    // content") and rebuilds once, rather than failing on an INSERT with the new column list.
    const columns = new Set(
      (db.query("PRAGMA table_info(m)").all() as Array<{ name: string }>).map((column) => column.name),
    )
    if (!columns.has("t")) db.exec("ALTER TABLE m ADD COLUMN t INTEGER NOT NULL DEFAULT 0")
    if (!columns.has("s")) db.exec("ALTER TABLE m ADD COLUMN s INTEGER NOT NULL DEFAULT 0")
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS t USING fts5(body, tokenize='trigram case_sensitive ${sensitive ? 1 : 0}', content='', contentless_delete=1, detail='none')`,
    )
    const index = new TrigramIndex(db)
    index.setMeta("version", String(SCHEMA_VERSION))
    return index
  }

  close(): void {
    // Release the -wal/-shm side files: on Windows they keep the directory busy after close.
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch {
      // best effort — the database may already be closed or read-only
    }
    this.db.close()
  }

  /** Number of files the index knows about, including ones that were never indexable. */
  get size(): number {
    return this.db.prepare<{ n: number }, []>("SELECT count(*) AS n FROM m").get()!.n
  }

  /** Number of files whose content is actually in the index. */
  get indexed(): number {
    return this.db.prepare<{ n: number }, []>("SELECT count(*) AS n FROM m WHERE t >= 0").get()!.n
  }

  getMeta(key: string): string | undefined {
    return this.db.prepare<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(key)?.v
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(key, value)
  }

  /** All indexed paths, normalized. Used to diff the index against the current file list. */
  paths(): string[] {
    return this.db.prepare<{ p: string }, []>("SELECT p FROM m ORDER BY p").all().map((r) => r.p)
  }

  /**
   * Path → fingerprint for everything the index enumerated. A row recorded as `NOT_INDEXED` was
   * seen but not stored (binary); `mtimeMs === 0` means the row predates fingerprints, so the
   * caller has nothing to compare and must rebuild.
   */
  fingerprints(): Map<string, Fingerprint> {
    const rows = this.db.prepare<{ p: string; t: number; s: number }, []>("SELECT p, t, s FROM m").all()
    return new Map(rows.map((row) => [row.p, { mtimeMs: row.t, size: row.s }]))
  }

  /**
   * Full rebuild in one transaction. Files whose content contains a NUL byte are recorded but not
   * indexed (they are binary; rg handles them natively and trigrams over binary junk only cost
   * size) — recording them keeps the stored path set equal to the enumerated one, which is what
   * lets the next run tell "unchanged" from "drifted".
   */
  replaceAll(files: Iterable<readonly [path: string, content: string, fingerprint?: Fingerprint]>): void {
    const insertM = this.db.prepare("INSERT INTO m(id, p, t, s) VALUES (?, ?, ?, ?)")
    const insertT = this.db.prepare("INSERT INTO t(rowid, body) VALUES (?, ?)")
    this.db.transaction(() => {
      this.db.exec("DELETE FROM m")
      this.db.exec("INSERT INTO t(t) VALUES ('delete-all')")
      let id = 1
      for (const [rawPath, content, fingerprint] of files) {
        const binary = content.includes("\0")
        insertM.run(
          id,
          normalize(rawPath),
          binary ? NOT_INDEXED : Math.floor(fingerprint?.mtimeMs ?? 0),
          binary ? 0 : Math.floor(fingerprint?.size ?? Buffer.byteLength(content, "utf-8")),
        )
        if (!binary) insertT.run(id, content)
        id++
      }
      this.setMeta("files", String(this.indexed))
      this.setMeta("built_at", String(Date.now()))
    })()
  }

  /** Incremental update: content null removes the file. Cheap enough to call per watcher event. */
  upsert(path: string, content: string | null, fingerprint?: Fingerprint): void {
    const normalized = normalize(path)
    this.db.transaction(() => {
      const row = this.db.prepare<{ id: number }, [string]>("SELECT id FROM m WHERE p = ?").get(normalized)
      if (row) {
        this.db.prepare("DELETE FROM t WHERE rowid = ?").run(row.id)
        this.db.prepare("DELETE FROM m WHERE id = ?").run(row.id)
      }
      if (content !== null) {
        const binary = content.includes("\0")
        const id = this.db.prepare<{ n: number }, []>("SELECT coalesce(max(id), 0) + 1 AS n FROM m").get()!.n
        this.db
          .prepare("INSERT INTO m(id, p, t, s) VALUES (?, ?, ?, ?)")
          .run(
            id,
            normalized,
            binary ? NOT_INDEXED : Math.floor(fingerprint?.mtimeMs ?? 0),
            binary ? 0 : Math.floor(fingerprint?.size ?? Buffer.byteLength(content, "utf-8")),
          )
        if (!binary) this.db.prepare("INSERT INTO t(rowid, body) VALUES (?, ?)").run(id, content)
      }
      this.setMeta("files", String(this.indexed))
    })()
  }

  /**
   * Files whose indexed text contains every trigram of `query` — a superset of the files
   * containing the literal query (when the index folds case, also of any case variant).
   * Returns null when the query is shorter than three characters: nothing to prefilter with,
   * the caller should search without candidates.
   */
  candidates(query: string): string[] | null {
    const grams = new Set<string>()
    for (let i = 0; i + TRIGRAM_MIN <= query.length; i++) grams.add(query.slice(i, i + TRIGRAM_MIN))
    if (grams.size === 0) return null
    let ids: Set<number> | null = null
    for (const gram of grams) {
      // .values() sidesteps bun's row-object mapping; a single column comes back as [rowid].
      const rows = this.matchOne.values(`"${gram.replaceAll('"', '""')}"`) as Array<[number]>
      const got = new Set<number>(rows.map((r) => Number(r[0])))
      if (ids === null) {
        ids = got
      } else {
        const kept = new Set<number>()
        for (const id of ids) if (got.has(id)) kept.add(id)
        ids = kept
      }
      if (ids.size === 0) return []
    }
    const lookup = this.db.prepare<{ p: string }, [number]>("SELECT p FROM m WHERE id = ?")
    return [...ids!].map((id) => lookup.get(id)!.p)
  }
}
