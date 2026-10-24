import { expect, test } from "bun:test"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Variant } from "../src/variant.js"

const OPENAI_COMPATIBLE = "@opencode/ai/providers/openai-compatible"

const model = (id: string) => ({
  ...Model.Info.default(Provider.ID.make("relay"), Model.ID.make(id)),
  package: OPENAI_COMPATIBLE,
})

test("only the no-thinking strength adds the DeepSeek switch", () => {
  const variants = Variant.resolve(model("deepseek-v4.1-flash"), [{ type: "effort", values: ["low", "high"] }])
  expect(variants.map((variant) => variant.id)).toEqual(["low", "high"])
  // Thinking is on by default, so enabling it would be a no-op; leaving the field off keeps these
  // paths byte-identical to the generic route.
  expect(variants[0]).toEqual({ id: "low", settings: { reasoningEffort: "low" } })
  expect(variants[1]).toEqual({ id: "high", settings: { reasoningEffort: "high" } })
})

test("a disabled strength turns the switch off rather than omitting it", () => {
  const variants = Variant.resolve(model("deepseek-v4.1-flash"), [{ type: "effort", values: ["none"] }])
  expect(variants[0]).toMatchObject({ body: { thinking: { type: "disabled" } } })
})

test("other models keep the plain reasoning_effort overlay", () => {
  const variants = Variant.resolve(model("gpt-5"), [{ type: "effort", values: ["low"] }])
  expect(variants[0]).toEqual({ id: "low", settings: { reasoningEffort: "low" } })
})
