import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z, type ZodTypeAny } from "zod";
import { EuromailClient } from "./client.js";
import { runTool, tools, type ToolDef } from "./tools.js";

// The published OpenAPI document. `npm run check:published` fails when it
// differs from what the API serves; `-- --write` refreshes it.
type Schema = Record<string, any>;
const spec = JSON.parse(
  readFileSync(new URL("../test/fixtures/openapi.json", import.meta.url), "utf8")
) as { paths: Record<string, Record<string, any>>; components: { schemas: Record<string, Schema> } };

function resolve(schema: Schema | undefined): Schema {
  let s = schema ?? {};
  while (s.$ref) s = spec.components.schemas[s.$ref.split("/").pop()!];
  return s;
}

/** Property schemas and required names of an object schema, merging allOf/oneOf branches. */
function objectShape(schema: Schema | undefined): { props: Schema; required: string[] } | undefined {
  const s = resolve(schema);
  const branches = [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])];
  const merged = { props: { ...(s.properties ?? {}) } as Schema, required: [...(s.required ?? [])] };
  let found = s.properties !== undefined;
  for (const branch of branches) {
    const sub = objectShape(branch);
    if (sub) {
      found = true;
      Object.assign(merged.props, sub.props);
      merged.required.push(...sub.required);
    }
  }
  return found ? merged : undefined;
}

/** A value for a zod type; `min` fills required fields only. */
function sample(type: ZodTypeAny, min: boolean): unknown {
  const def = type._def;
  switch (def.typeName) {
    case "ZodOptional":
      return sample(def.innerType, min);
    case "ZodString":
      return "x";
    case "ZodNumber":
      return 1;
    case "ZodBoolean":
      return true;
    case "ZodEnum":
      return def.values[0];
    case "ZodUnion":
      return sample(def.options[0], min);
    case "ZodArray":
      return [sample(def.type, min)];
    case "ZodRecord":
      return {};
    case "ZodObject":
      return sampleShape(def.shape(), min);
    default:
      throw new Error(`sample(): unsupported zod type ${def.typeName}`);
  }
}

function sampleShape(shape: Record<string, ZodTypeAny>, min: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(shape)) {
    if (min && type.isOptional()) continue;
    out[key] = sample(type, min);
  }
  return out;
}

function findOperation(method: string, path: string): Schema | undefined {
  const exact = spec.paths[path]?.[method.toLowerCase()];
  if (exact) return exact;
  for (const [template, ops] of Object.entries(spec.paths)) {
    const re = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    if (re.test(path) && ops[method.toLowerCase()]) return ops[method.toLowerCase()];
  }
  return undefined;
}

/** Every key must be declared by the schema, recursing into arrays of objects. */
function assertKnownKeys(value: unknown, schema: Schema | undefined, where: string): void {
  const s = resolve(schema);
  if (Array.isArray(value)) {
    for (const item of value) assertKnownKeys(item, s.items, `${where}[]`);
    return;
  }
  const shape = objectShape(s);
  if (!shape || typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(key in shape.props, `${where}: field "${key}" is not in the API schema`);
    assertKnownKeys(child, shape.props[key], `${where}.${key}`);
  }
}

/** Every field the API requires must be present in a request built from required tool input only. */
function assertRequiredKeys(value: unknown, schema: Schema | undefined, where: string): void {
  const s = resolve(schema);
  if (Array.isArray(value)) {
    for (const item of value) assertRequiredKeys(item, s.items, `${where}[]`);
    return;
  }
  const shape = objectShape(s);
  if (!shape || typeof value !== "object" || value === null) return;
  for (const name of shape.required) {
    assert.ok(name in value, `${where}: API requires "${name}" but the tool does not make it mandatory`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertRequiredKeys(child, shape.props[key], `${where}.${key}`);
  }
}

function build(def: ToolDef, min: boolean) {
  const args = sampleShape(def.inputSchema as Record<string, ZodTypeAny>, min);
  return def.request(z.object(def.inputSchema).parse(args));
}

describe("tool requests match the published OpenAPI document", () => {
  it("has unique tool names", () => {
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });

  for (const def of tools) {
    it(def.name, () => {
      const full = build(def, false);
      const path = `/v1${full.path}`;
      const op = findOperation(full.method, path);
      assert.ok(op, `${full.method} ${path} is not an operation in the API`);

      const queryNames = new Set<string>(
        (op.parameters ?? []).filter((p: Schema) => p.in === "query").map((p: Schema) => p.name)
      );
      for (const key of Object.keys(full.query ?? {})) {
        assert.ok(queryNames.has(key), `query parameter "${key}" is not accepted by ${full.method} ${path}`);
      }

      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (full.body !== undefined) {
        assert.ok(bodySchema, `${full.method} ${path} takes no JSON body`);
        assertKnownKeys(full.body, bodySchema, "body");
        assertRequiredKeys(build(def, true).body, bodySchema, "body");
      } else if (bodySchema) {
        assert.deepEqual(resolve(bodySchema).required ?? [], [], `${full.method} ${path} needs a body`);
      }
    });
  }
});

describe("runTool", () => {
  const client = (response: () => Promise<unknown>) =>
    ({ send: response }) as unknown as EuromailClient;
  const byName = (name: string) => tools.find((t) => t.name === name)!;

  it("returns API failures to the model as an error result", async () => {
    const result = await runTool(
      byName("get_email"),
      client(async () => {
        throw new Error("API error 404: not found: email");
      }),
      { id: "abc" }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /API error 404: not found: email/);
  });

  it("marks mailbox message content as untrusted", async () => {
    const result = await runTool(
      byName("read_mailbox_messages"),
      client(async () => ({ messages: [] })),
      { mailbox_id: "m1" }
    );
    assert.match(result.content[0].text, /^WARNING: untrusted external email content/);
  });
});

describe("documentation", () => {
  const names = tools.map((t) => t.name);
  // The docs site's guide is checked by `npm run check:published`.
  const docs = [new URL("../README.md", import.meta.url)];

  for (const doc of docs) {
    it(`${doc.pathname.split("/").slice(-3).join("/")} lists exactly the tools the server exposes`, () => {
      const text = readFileSync(doc, "utf8");
      const mentioned = new Set(
        [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]).filter((n) => !n.startsWith("euromail_"))
      );
      const toolLike = [...mentioned].filter((n) => !["double_opt_in"].includes(n));
      assert.deepEqual(
        names.filter((n) => !mentioned.has(n)),
        [],
        "tools missing from the doc"
      );
      assert.deepEqual(
        toolLike.filter((n) => !names.includes(n)),
        [],
        "doc names tools the server does not expose"
      );
    });
  }
});
