#!/usr/bin/env node
// Checks this package against what euromail.dev publishes.
//
// - test/fixtures/openapi.json must equal the OpenAPI document the API
//   serves. The tool tests run against the fixture, so a stale one would let
//   a tool keep calling an operation the API changed.
// - With --guide, the MCP guide on the docs site must list exactly the tools
//   this server exposes. The guide lives in the euromail.dev repo, so a new
//   tool lands here first and the guide follows.
//
//   npm run check:published                # fixture
//   npm run check:published -- --guide     # fixture and guide
//   npm run check:published -- --write     # refresh the fixture
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { tools } from "../dist/tools.js";

const OPENAPI_URL = process.env.EUROMAIL_OPENAPI_URL ?? "https://api.euromail.dev/api-docs/openapi.json";
const GUIDE_URL = process.env.EUROMAIL_GUIDE_URL ?? "https://euromail.dev/docs/guides/mcp-server/";
const FIXTURE = new URL("../test/fixtures/openapi.json", import.meta.url);

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.text();
}

// Keys sorted at every level, so the fixture diffs cleanly between refreshes.
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])]));
  }
  return value;
}

const failures = [];

const published = JSON.parse(await fetchText(OPENAPI_URL));
if (process.argv.includes("--write")) {
  writeFileSync(FIXTURE, JSON.stringify(sorted(published), null, 2) + "\n");
  console.log(`wrote test/fixtures/openapi.json from ${OPENAPI_URL}`);
} else if (!isDeepStrictEqual(JSON.parse(readFileSync(FIXTURE, "utf8")), published)) {
  failures.push(
    `test/fixtures/openapi.json differs from ${OPENAPI_URL}.\n` +
      "  Check the tools against the API change, then run `npm run check:published -- --write` and `npm test`."
  );
}

if (process.argv.includes("--guide")) {
  const html = await fetchText(GUIDE_URL);
  const mentioned = new Set(
    [...html.matchAll(/<code>([a-z]+(?:_[a-z]+)+)<\/code>/g)]
      .map((m) => m[1])
      .filter((n) => !n.startsWith("euromail_") && n !== "double_opt_in")
  );
  const names = tools.map((t) => t.name);
  const missing = names.filter((n) => !mentioned.has(n));
  const unknown = [...mentioned].filter((n) => !names.includes(n));
  if (missing.length) failures.push(`${GUIDE_URL} does not list: ${missing.join(", ")}`);
  if (unknown.length) failures.push(`${GUIDE_URL} lists tools the server does not expose: ${unknown.join(", ")}`);
}

if (failures.length) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("check-published: matches what euromail.dev publishes");
