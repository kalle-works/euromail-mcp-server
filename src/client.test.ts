import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { EuromailClient } from "./client.js";

const env = { EUROMAIL_API_KEY: "em_live_test", EUROMAIL_API_URL: "https://test.euromail.dev/" };

function mockFetch(response: Partial<Response> & { status?: number }) {
  const fn = mock.fn(async () => ({ ok: true, status: 200, ...response }));
  mock.method(globalThis, "fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>): [string, RequestInit] {
  return fn.mock.calls[0].arguments as unknown as [string, RequestInit];
}

describe("EuromailClient", () => {
  afterEach(() => mock.restoreAll());

  it("refuses to start without an API key", () => {
    assert.throws(() => new EuromailClient({}), /EUROMAIL_API_KEY environment variable is required/);
  });

  it("never sends the API key over plain http except to localhost", () => {
    assert.throws(
      () => new EuromailClient({ ...env, EUROMAIL_API_URL: "http://api.example.com" }),
      /must use https/
    );
    assert.doesNotThrow(
      () => new EuromailClient({ ...env, EUROMAIL_API_URL: "http://localhost:3000" })
    );
  });

  it("defaults to the production API", async () => {
    const fn = mockFetch({ json: async () => ({}) });
    await new EuromailClient({ EUROMAIL_API_KEY: "k" }).send({ method: "GET", path: "/account" });
    assert.equal(lastCall(fn)[0], "https://api.euromail.dev/v1/account");
  });

  it("authenticates with a Bearer header and builds the URL under /v1", async () => {
    const fn = mockFetch({ json: async () => ({ ok: 1 }) });
    const result = await new EuromailClient(env).send({
      method: "GET",
      path: "/emails",
      query: { page: 2, status: undefined, per_page: 5 },
    });
    const [url, init] = lastCall(fn);
    assert.deepEqual(result, { ok: 1 });
    assert.equal(url, "https://test.euromail.dev/v1/emails?page=2&per_page=5");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer em_live_test");
  });

  it("sends the JSON body for writes", async () => {
    const fn = mockFetch({ json: async () => ({}) });
    const body = { from: "a@b.com", to: "c@d.com" };
    await new EuromailClient(env).send({ method: "POST", path: "/emails", body });
    const [, init] = lastCall(fn);
    assert.equal(init.method, "POST");
    assert.equal(init.body, JSON.stringify(body));
  });

  it("surfaces the API error message with its status", async () => {
    mockFetch({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: { code: "unprocessable", message: "domain is not verified" } }),
    });
    await assert.rejects(
      () => new EuromailClient(env).send({ method: "POST", path: "/emails", body: {} }),
      /API error 422: domain is not verified \(unprocessable\)/
    );
  });

  it("surfaces a non-JSON error body as is", async () => {
    mockFetch({ ok: false, status: 502, text: async () => "Bad gateway" });
    await assert.rejects(
      () => new EuromailClient(env).send({ method: "GET", path: "/account" }),
      /API error 502: Bad gateway/
    );
  });

  it("reports success for an empty 204 response", async () => {
    mockFetch({ status: 204 });
    const result = await new EuromailClient(env).send({ method: "DELETE", path: "/templates/x" });
    assert.deepEqual(result, { success: true });
  });

  it("returns the raw body for text responses", async () => {
    mockFetch({ text: async () => "date,sent\n2026-10-01,3\n" });
    const result = await new EuromailClient(env).send({
      method: "GET",
      path: "/analytics/export",
      response: "text",
    });
    assert.equal(result, "date,sent\n2026-10-01,3\n");
  });
});
