import type { OperationDefinition, ToolExecutor, UniversalDocumentation } from "../types.js";
import { HttpApiExecutor } from "./HttpApiExecutor.js";
import { UpstreamMcpExecutor } from "./UpstreamMcpExecutor.js";

export class RoutingToolExecutor implements ToolExecutor {
  private readonly http: HttpApiExecutor;
  private readonly upstream?: UpstreamMcpExecutor;

  constructor(model: UniversalDocumentation, options: {
    api?: { baseUrl?: string; headers?: Record<string, string>; authEnv?: Record<string, string>; timeoutMs?: number };
    upstream?: { url?: string; headers?: Record<string, string>; timeoutMs?: number };
  }) {
    this.http = new HttpApiExecutor(model, options.api);
    if (options.upstream?.url) {
      this.upstream = new UpstreamMcpExecutor(
        options.upstream.url,
        options.upstream.timeoutMs ?? 30_000,
        options.upstream.headers ?? {}
      );
    }
  }

  async execute(operation: OperationDefinition, args: Record<string, unknown>): Promise<unknown> {
    if (operation.sourceHttp) return this.http.execute(operation, args);
    if (!this.upstream) throw new Error("No upstream MCP endpoint is configured for " + operation.toolName + ".");
    return this.upstream.execute(operation, args);
  }

  async close(): Promise<void> {
    await this.upstream?.close();
  }
}
