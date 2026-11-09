import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { MCPForgerConfig, UniversalDocumentation } from "../types.js";
import { createChannelServer } from "./ChannelServer.js";
import { createMcpServer } from "./MCPServerFactory.js";
import { UpstreamMcpExecutor } from "./UpstreamMcpExecutor.js";

export async function runFromConfig(configLocation: string | URL): Promise<void> {
  const configPath = configLocation instanceof URL ? fileURLToPath(configLocation) : resolve(configLocation);
  const config = JSON.parse(await readFile(configPath, "utf8")) as MCPForgerConfig & {
    modelFile?: string;
    outputDir?: string;
  };
  const outputDir = config.outputDir ? resolve(dirname(configPath), config.outputDir) : dirname(configPath);
  const modelFile = config.modelFile ?? "docs2mcp.universal.json";
  const modelPath = resolve(outputDir, modelFile);
  const model = JSON.parse(await readFile(modelPath, "utf8")) as UniversalDocumentation;
  const upstreamUrl = config.upstream?.url ?? model.source.upstream?.url;
  if (!upstreamUrl) {
    throw new Error("No upstream MCP URL is configured. The documentation describes an SDK but does not expose an executable HTTP API.");
  }

  const executor = new UpstreamMcpExecutor(upstreamUrl, config.upstream?.timeoutMs ?? 30_000, config.upstream?.headers ?? {});
  const channels = {
    rest: config.channels?.rest ?? model.channels.rest,
    ws: config.channels?.ws ?? model.channels.ws,
    stdio: config.channels?.stdio ?? model.channels.stdio,
    mcpHttp: config.channels?.mcpHttp ?? model.channels.mcpHttp
  };
  const serverOptions = config.server ?? {};
  let app: Awaited<ReturnType<typeof createChannelServer>> | undefined;

  if (channels.rest || channels.ws || channels.mcpHttp) {
    app = await createChannelServer(model, executor, {
      rest: channels.rest,
      ws: channels.ws,
      mcpHttp: channels.mcpHttp
    });
    const host = serverOptions.host ?? "127.0.0.1";
    const port = serverOptions.port ?? 8787;
    await app.listen({ host, port });
    console.error("[docs2mcp] HTTP channels listening at http://" + host + ":" + port);
    if (channels.rest) console.error("[docs2mcp] REST: http://" + host + ":" + port + "/api/v1/tools");
    if (channels.ws) console.error("[docs2mcp] WebSocket: ws://" + host + ":" + port + "/ws");
    if (channels.mcpHttp) console.error("[docs2mcp] MCP HTTP: http://" + host + ":" + port + "/mcp");
  }

  if (channels.stdio) {
    console.error("[docs2mcp] stdio MCP channel ready.");
    await serveStdio(() => createMcpServer(model, executor));
  }

  if (!channels.stdio && !app) throw new Error("No runtime channels are enabled in the configuration.");

  const shutdown = async (): Promise<void> => {
    await app?.close();
    await executor.close();
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}