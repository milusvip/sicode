import { describe, expect, test } from "bun:test"
import { modelRow, validateCustomProvider } from "./form"

const t = (key: string) => key

const model = (id: string, name = "") => ({ ...modelRow(), id, name })

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [model(" model-a ", " Model A ")],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        name: "Custom Provider",
        package: "aisdk:@ai-sdk/openai-compatible",
        env: ["CUSTOM_PROVIDER_KEY"],
        settings: {
          baseURL: "https://api.example.com",
        },
        headers: {
          "X-Test": "enabled",
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("allows editing the same provider id", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [model("model-a", "Model A")],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.result?.providerID).toBe("custom-provider")
  })

  test("falls back to the model id when the display name is empty", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [model("model-a")],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({ "model-a": { name: "model-a" } })
  })

  test("writes capabilities and limits only where they differ from the defaults", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          { ...model("plain"), tools: true, image: true, reasoning: false },
          {
            ...model("small"),
            tools: false,
            image: false,
            reasoning: true,
            context: "32768",
            output: "8192",
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      plain: { name: "plain" },
      small: {
        name: "small",
        capabilities: { tools: false, input: ["text"], reasoning: { supported: true } },
        limit: { context: 32768, output: 8192 },
      },
    })
  })

  test("rejects window sizes that are not positive whole numbers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [{ ...model("model-a"), context: "128k", output: "-1" }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0]).toEqual({
      id: undefined,
      context: "provider.custom.error.number",
      output: "provider.custom.error.number",
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [model("model-a", "Model A"), model("model-a", "Model A 2")],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      context: undefined,
      output: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })
})
