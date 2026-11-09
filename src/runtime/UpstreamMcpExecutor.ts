import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { OperationDefinition, ToolExecutor } from "../types.js";

interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split("_").filter((token) => token.length > 1));
}

function scoreMatch(operation: OperationDefinition, tool: UpstreamTool): number {
  const target = new Set([
    ...tokens(operation.toolName),
    ...tokens(operation.title),
    ...tokens(operation.sourceMethod),
    ...tokens(operation.sourceAnchor),
    ...operation.upstreamAliases.flatMap((alias) => [...tokens(alias)])
  ]);
  const candidate = tokens(tool.name);
  if (normalize(tool.name) === normalize(operation.toolName)) return 100;
  if (operation.upstreamAliases.some((alias) => normalize(alias) === normalize(tool.name))) return 95;
  let overlap = 0;
  for (const token of candidate) if (target.has(token)) overlap += 1;
  if (candidate.size === 0 || target.size === 0) return 0;
  const ratio = overlap / Math.max(candidate.size, target.size);
  return Math.round(ratio * 80) + (overlap > 0 ? 1 : 0);
}

function adaptArguments(
  args: Record<string, unknown>,
  tool: UpstreamTool
): Record<string, unknown> {
  const properties = tool.inputSchema?.properties;
  if (!properties) return args;
  const adapted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (Object.hasOwn(properties, key)) {
      adapted[key] = value;
      continue;
    }
    if (key.endsWith("_url") && Object.hasOwn(properties, "url")) {
      adapted.url = value;
      continue;
    }
    const camel = key.replace(/_([a-z])/g, (_match, character: string) => character.toUpperCase());
    if (Object.hasOwn(properties, camel)) {
      adapted[camel] = value;
      continue;
    }
    if (key === "configuration" && Object.hasOwn(properties, "config")) {
      adapted.config = value;
    }
  }

  return adapted;
}

export class UpstreamMcpExecutor implements ToolExecutor {
  private client: Client | undefined;
  private tools: UpstreamTool[] = [];
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs = 30_000,
    private readonly headers: Record<string, string> = {}
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Upstream MCP endpoint must use HTTP or HTTPS.");
    }
  }

  private async connect(): Promise<void> {
    if (this.client && this.tools.length > 0) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = new Client(
        { name: "docs2mcp-generated-client", version: "0.1.0" },
        { versionNegotiation: { mode: "auto", probe: { timeoutMs: this.timeoutMs } } }
      );
      const transport = new StreamableHTTPClientTransport(new URL(this.endpoint), {
        requestInit: {
          headers: this.headers
        }
      });
      await client.connect(transport);
      const response = await client.listTools();
      this.client = client;
      this.tools = response.tools as UpstreamTool[];
    })();

    try {
      await this.connecting;
    } catch (error) {
      this.client = undefined;
      this.tools = [];
      throw error;
    } finally {
      this.connecting = undefined;
    }
  }

  async execute(operation: OperationDefinition, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    if (!this.client) throw new Error("Upstream MCP client did not connect.");

    const ranked = this.tools
      .map((tool) => ({ tool, score: scoreMatch(operation, tool) }))
      .sort((left, right) => right.score - left.score);
    const match = ranked[0];
    if (!match || match.score < 25) {
      throw new Error(
        "No upstream MCP tool matched " + operation.toolName +
        ". Discovered tools: " + this.tools.map((tool) => tool.name).join(", ")
      );
    }

    const upstreamArguments = adaptArguments(args, match.tool);
    const result = await this.client.callTool({
      name: match.tool.name,
      arguments: upstreamArguments
    });
    if (result.isError) {
      const message = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(message || "Upstream MCP tool " + match.tool.name + " failed.");
    }

    if (result.structuredContent !== undefined) return result.structuredContent;
    return result.content;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.tools = [];
  }
}