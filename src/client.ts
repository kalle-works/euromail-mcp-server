/**
 * HTTP client for the EuroMail REST API.
 */

const DEFAULT_BASE_URL = "https://api.euromail.dev";
const REQUEST_TIMEOUT_MS = 30_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type QueryValue = string | number | boolean | undefined;

/** One API call, described without any transport detail. Paths exclude the `/v1` prefix. */
export interface ApiRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** `text` returns the raw body (CSV export) instead of parsing JSON. */
  response?: "json" | "text";
}

export class EuromailClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.apiKey = env.EUROMAIL_API_KEY ?? "";
    this.baseUrl = (env.EUROMAIL_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

    const url = new URL(this.baseUrl);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) {
      throw new Error(
        `EUROMAIL_API_URL must use https (got ${url.protocol}//${url.host}); the API key travels with every request.`
      );
    }

    if (!this.apiKey) {
      throw new Error(
        "EUROMAIL_API_KEY environment variable is required. " +
          "Create a key at https://dashboard.euromail.dev and set it in your MCP server configuration."
      );
    }
  }

  async send(req: ApiRequest): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    const url = `${this.baseUrl}/v1${req.path}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: req.response === "text" ? "text/csv, application/json" : "application/json",
      "User-Agent": "euromail-mcp-server",
    };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(
          `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${req.method} /v1${req.path}`
        );
      }
      throw err;
    }

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${describeError(await res.text())}`);
    }
    if (res.status === 204) return { success: true };
    if (req.response === "text") return res.text();
    return res.json();
  }
}

/** The API answers errors as `{"error": {"code", "message"}}`; fall back to the raw body. */
function describeError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    const message = parsed.error?.message;
    if (message) return parsed.error?.code ? `${message} (${parsed.error.code})` : message;
  } catch {
    // not JSON; use the body, shortened (a proxy's HTML error page is noise)
  }
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}
