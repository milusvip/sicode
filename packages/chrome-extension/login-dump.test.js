import { describe, expect, test } from "bun:test"
import {
  MAX_CONTEXT_ENTRIES,
  MAX_COOKIES,
  MAX_DUMP_CHARS,
  MAX_STORAGE,
  loginStateDump,
  selectLoginState,
} from "./login-dump.js"

const cookie = (name, value = "v", extra = {}) => ({ name, value, domain: ".a.test", path: "/", ...extra })

describe("selectLoginState", () => {
  test("keeps the session and drops measurement, consent and app state", () => {
    const { cookies, storage, skipped } = selectLoginState(
      [
        cookie("sessionid", "s3cr3t"),
        cookie("_ga", "GA1.2.3"),
        cookie("_gid", "GA1.2.4"),
        cookie("OptanonConsent", "groups=C0001"),
        cookie("IDE", "AHWq"),
        cookie("lang", "zh"),
        cookie("__cf_bm", "cf"),
        cookie("theme", "dark"),
      ],
      [
        { key: "userToken", value: "eyJhbGci" },
        { key: "amplitude_session_id", value: "abc" },
        { key: "chat_drafts", value: "a long pile of app state" },
      ],
    )

    expect(cookies.map((entry) => entry.name)).toEqual(["sessionid", "__cf_bm", "lang", "theme"])
    expect(storage.map((row) => row.key)).toEqual(["userToken", "chat_drafts"])
    // _ga, _gid, OptanonConsent and IDE are trackers; amplitude_session_id is one whose `_session`
    // would have matched the auth pattern, which is why the tracker check has to run first.
    expect(skipped).toBe(5)
  })

  test("a name that merely starts like a tracker is kept", () => {
    // The tracker list is exact on purpose: a loose `^IDE` would have dropped a real login cookie.
    const { cookies } = selectLoginState(
      [cookie("IDENTITY_TOKEN", "t"), cookie("_gameSession", "s"), cookie("IDEASHARE", "i"), cookie("IDE", "x")],
      [],
    )

    expect(cookies.map((entry) => entry.name)).toEqual(["IDENTITY_TOKEN", "_gameSession", "IDEASHARE"])
  })

  test("a GA4 per-property cookie is a tracker, but a page's own _ga-looking name is not", () => {
    const { cookies } = selectLoginState([cookie("_ga_ABC123", "GS1"), cookie("_gateway_session", "s")], [])

    expect(cookies.map((entry) => entry.name)).toEqual(["_gateway_session"])
  })

  test("credentials come first, so a budget cut never drops the login", () => {
    const plain = Array.from({ length: 30 }, (_, index) => cookie(`pref${index}`, "x".repeat(1_000)))
    const { cookies } = selectLoginState([...plain, cookie("sessionid", "s3cr3t")], [])

    // The small pasted total is the point: the session survived the cut, and the flood did not.
    expect(cookies[0].name).toBe("sessionid")
    expect(cookies.length).toBeLessThan(30)
    expect(JSON.stringify(cookies).length).toBeLessThanOrEqual(MAX_DUMP_CHARS)
  })

  test("app state cannot crowd out the session, however many small keys it has", () => {
    // A hundred tiny analytics keys used to cost more than the allowance one by one, so the count is
    // capped as well as the bytes; a site that only has app state still yields a paste, just a short one.
    const noise = Array.from({ length: 100 }, (_, index) => ({ key: `bucket${index}`, value: "b" }))
    const { cookies, storage, skipped } = selectLoginState([cookie("sid", "s")], [
      ...noise,
      { key: "userToken", value: "eyJhbGci" },
    ])

    expect(cookies.map((entry) => entry.name)).toEqual(["sid"])
    expect(storage[0].key).toBe("userToken")
    expect(storage.length).toBeLessThanOrEqual(MAX_CONTEXT_ENTRIES + 1)
    expect(skipped).toBeGreaterThan(80)
  })

  test("the context allowance is spent on the first entries the page had", () => {
    // A site that needs a CSRF cookie and its language keeps them; the tenth small entry is the last.
    const ordinary = Array.from({ length: 20 }, (_, index) => cookie(`pref${index}`, "v"))
    const { cookies } = selectLoginState(ordinary, [])

    expect(cookies).toHaveLength(MAX_CONTEXT_ENTRIES)
    expect(cookies.map((entry) => entry.name)).toEqual(ordinary.slice(0, MAX_CONTEXT_ENTRIES).map((c) => c.name))
  })

  test("a value too large to be a credential is left out", () => {
    const { cookies, skipped } = selectLoginState([cookie("blob", "x".repeat(20_000)), cookie("sid", "s")], [])

    expect(cookies.map((entry) => entry.name)).toEqual(["sid"])
    expect(skipped).toBe(1)
  })

  test("the count caps hold even when every entry looks like a credential", () => {
    const many = Array.from({ length: 60 }, (_, index) => cookie(`auth_${index}`))
    const rows = Array.from({ length: 60 }, (_, index) => ({ key: `token_${index}`, value: "v" }))
    const { cookies, storage, skipped } = selectLoginState(many, rows)

    expect(cookies).toHaveLength(MAX_COOKIES)
    expect(storage).toHaveLength(MAX_STORAGE)
    expect(skipped).toBe(40)
  })

  test("only the cookie fields the pane writes survive", () => {
    // hostOnly, session and storeId are a third of Chrome's cookie object and say nothing.
    const { cookies } = selectLoginState(
      [cookie("sid", "s", { hostOnly: false, session: false, storeId: "0", secure: true, sameSite: "lax" })],
      [],
    )

    expect(cookies[0]).toEqual({
      name: "sid",
      value: "s",
      domain: ".a.test",
      path: "/",
      secure: true,
      sameSite: "lax",
    })
  })
})

describe("loginStateDump", () => {
  test("the text is the JSON the in-app browser imports", () => {
    const dump = loginStateDump("https://a.test/app", [cookie("sid", "s")], [{ key: "userToken", value: "eyJ" }])

    expect(JSON.parse(dump.text)).toEqual({
      url: "https://a.test/app",
      cookies: [{ name: "sid", value: "s", domain: ".a.test", path: "/" }],
      localStorage: { userToken: "eyJ" },
    })
    expect(dump).toMatchObject({ cookies: 1, storage: 1, skipped: 0 })
  })

  test("a site that keeps its session in localStorage alone still yields a paste", () => {
    const dump = loginStateDump("https://a.test/", [cookie("_ga", "GA1")], [{ key: "authToken", value: "t" }])

    expect(dump.cookies).toBe(0)
    expect(dump.storage).toBe(1)
    expect(JSON.parse(dump.text).cookies).toEqual([])
  })
})
