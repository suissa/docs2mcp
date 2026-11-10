import type { OperationDefinition, ToolExecutor, UniversalDocumentation } from "../types.js";

export interface HttpApiExecutorOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  authEnv?: Record<string, string>;
  timeoutMs?: number;
}

function wire(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function envKey(name: string): string {
  return "DOCS2MCP_" + name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

export class HttpApiExecutor implements ToolExecutor {
  constructor(
    private readonly model: UniversalDocumentation,
    private readonly options: HttpApiExecutorOptions = {}
  ) {}

  async execute(operation: OperationDefinition, args: Record<string, unknown>): Promise<unknown> {
    const binding = operation.sourceHttp;
    if (!binding) throw new Error("Operation does not contain an HTTP source binding.");
    const base = this.options.baseUrl ?? binding.baseUrl ?? this.model.source.api?.baseUrl;
    if (!base) throw new Error("Set api.baseUrl in docs2mcp.config.json before calling source HTTP operations.");

    let path = binding.path;
    for (const parameter of operation.parameters.filter((item) => item.location === "path")) {
      const value = args[parameter.name];
      if (value === undefined || value === null) throw new Error("Missing path parameter: " + parameter.name);
      path = path.replaceAll("{" + parameter.name + "}", encodeURIComponent(wire(value)));
    }
    if (/\{[^}]+\}/.test(path)) throw new Error("Unresolved source path parameter: " + path);

    const url = new URL(base);
    url.pathname = url.pathname.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    url.search = "";
    const headers = new Headers({ accept: "application/json, */*;q=0.8", ...this.options.headers });

    for (const parameter of operation.parameters) {
      const value = args[parameter.name];
      if (value === undefined || value === null) continue;
      if (parameter.location === "query") {
        if (Array.isArray(value)) value.forEach((entry) => url.searchParams.append(parameter.name, wire(entry)));
        else url.searchParams.set(parameter.name, wire(value));
      } else if (parameter.location === "header") {
        headers.set(parameter.name, wire(value));
      }
    }

    this.applySecurity(operation, headers, url);
    const body = args.body;
    const init: RequestInit = {
      method: binding.method,
      headers,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000)
    };
    if (body !== undefined && !["GET", "HEAD"].includes(binding.method)) {
      const contentType = binding.requestContentType ?? "application/json";
      headers.set("content-type", contentType);
      init.body = contentType.includes("json") ? JSON.stringify(body) : wire(body);
    }

    const response = await fetch(url, init);
    const text = response.status === 204 ? "" : await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let result: unknown = text;
    if (text && /json/i.test(contentType)) {
      try { result = JSON.parse(text) as unknown; } catch { result = { raw: text }; }
    } else if (!text) result = null;

    if (!response.ok) {
      const detail = typeof result === "string" ? result : JSON.stringify(result);
      throw new Error("Source API HTTP " + response.status + ": " + detail.slice(0, 2000));
    }
    return result;
  }

  private applySecurity(operation: OperationDefinition, headers: Headers, url: URL): void {
    const schemes = this.model.source.api?.securitySchemes ?? {};
    for (const name of operation.sourceHttp?.security ?? []) {
      const scheme = schemes[name];
      if (!scheme || typeof scheme !== "object") continue;
      const record = scheme as Record<string, unknown>;
      const configured = this.options.authEnv?.[name] ?? envKey(name);
      const fallback = record.type === "apiKey" ? "DOCS2MCP_API_KEY" : "DOCS2MCP_BEARER_TOKEN";
      const credential = process.env[configured] ?? process.env[fallback];
      if (!credential) continue;

      if (record.type === "http" && record.scheme === "bearer") {
        headers.set("authorization", "Bearer " + credential);
      } else if (record.type === "http" && record.scheme === "basic") {
        headers.set("authorization", "Basic " + Buffer.from(credential).toString("base64"));
      } else if (record.type === "apiKey") {
        const name = typeof record.name === "string" ? record.name : "x-api-key";
        if (record.in === "query") url.searchParams.set(name, credential);
        else if (record.in === "cookie") {
          headers.set("cookie", [headers.get("cookie"), name + "=" + encodeURIComponent(credential)].filter(Boolean).join("; "));
        } else headers.set(name, credential);
      }
    }
  }
}
