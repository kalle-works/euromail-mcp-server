#!/usr/bin/env node

/**
 * EuroMail MCP server.
 *
 * Exposes the EuroMail email API to AI assistants over the Model Context
 * Protocol (stdio transport).
 */

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EuromailClient } from "./client.js";
import { registerTools } from "./tools.js";

let client: EuromailClient;
try {
  client = new EuromailClient();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

const server = new McpServer({ name: "euromail", version });
registerTools(server, client);

await server.connect(new StdioServerTransport());
console.error("EuroMail MCP server running on stdio");
