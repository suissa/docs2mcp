import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { MCPForgerConfig, UniversalDocumentation } from "../types.js";
import { createChannelServer } from "./ChannelServer.js";
import { createMcpServer } from "./MCPServerFactory.js";
import { RoutingToolExecutor } from "./RoutingToolExecutor.js";

export async function runFromConfig(configLocation: string | URL): Promise<void> {
  const configPath = configLocation instanceof URL ? fileURLToPath(configLocation) : resolve(configLocation);
  const config = JSON.parse(await readFile(configPath, "utf8")) as MCPForgerConfig & { modelFile?: string; outputDir?: string };
  const outputDir = config.outputDir ? resolve(dirname(configPath), config.outputDir) : dirname(configPath);
  const modelPath = resolve(outputDir, config.modelFile ?? "docs2mcp.universal.json");
  const model = JSON.parse(await readFile(modelPath, "utf8")) as UniversalDocumentation;
  const upstreamUrl = config.upstream?.url ?? model.source.upstream?.url;
  const hasHttp = model.operations.some((operation) => operation.sourceHttp);
  if (!upstreamUrl && !hasHttp) {
    throw new Error("No executable HTTP API or upstream MCP endpoint was found in the documentation.");
  }

  const executor = new RoutingToolExecutor(model, {
    api: {
      ...(config.api?.baseUrl ?? model.source.api?.baseUrl ? { baseUrl: config.api?.baseUrl ?? model.source.api?.baseUrl } : {}),
      ...(config.api?.headers ? { headers: config.api.headers } : {}),
      ...(config.api?.authEnv ? { authEnv: config.api.authEnv } : {}),
      ...(config.api?.timeoutMs ? { timeoutMs: config.api.timeoutMs } : {})
    },
    ...(upstreamUrl ? { upstream: { url: upstreamUrl, ...(config.upstream?.headers ? { headers: config.upstream.headers } : {}), ...(config.upstream?.timeoutMs ? { timeoutMs: config.upstream.timeoutMs } : {}) } } : {})
  });
  const channels = {
    rest: config.channels?.rest ?? model.channels.rest,
    ws: config.channels?.ws ?? model.channels.ws,
    stdio: config.channels?.stdio ?? model.channels.stdio,
    mcpHttp: config.channels?.mcpHttp ?? model.channels.mcpHttp
  };
  let app: Awaited<ReturnType<typeof createChannelServer>> | undefined;
  if (channels.rest || channels.ws || channels.mcpHttp) {
    app = await createChannelServer(model, executor, channels);
    const host = config.server?.host ?? "127.0.0.1";
    const port = config.server?.port ?? 8787;
    await app.listen({ host, port });
    console.error("[docs2mcp] HTTP channels listening at http://" + host + ":" + port);
  }

  const shutdown = async (): Promise<void> => {
    await app?.close();
    await executor.close();
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });

  if (channels.stdio) {
    console.error("[docs2mcp] stdio MCP channel ready.");
    await serveStdio(() => createMcpServer(model, executor));
  }
  if (!channels.stdio && !app) throw new Error("No runtime channels are enabled.");
}
