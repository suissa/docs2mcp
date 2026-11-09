import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import WebSocket from "ws";
import type { InspectorCheck, JsonSchema, OperationDefinition, UniversalDocumentation } from "../types.js";
import { EchoToolExecutor } from "../runtime/Executor.js";
import { createChannelServer } from "../runtime/ChannelServer.js";

function log(message: string): void {
  console.error("[docs2mcp:inspector] " + message);
}

async function wsRequest(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socket = new WebSocket(url);
  await once(socket, "open");
  const responsePromise = once(socket, "message");
  socket.send(JSON.stringify(payload));
  const [raw] = await responsePromise;
  socket.close();
  return JSON.parse(raw.toString()) as Record<string, unknown>;
}

function sampleValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return sampleValue(schema.anyOf[0] ?? {});
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return false;
  if (schema.type === "array") return [];
  if (schema.type === "object") {
    const result: Record<string, unknown> = {};
    for (const required of schema.required ?? []) {
      const property = schema.properties?.[required];
      if (property) result[required] = sampleValue(property);
    }
    return result;
  }
  if (schema.type === "null") return null;
  return "docs2mcp-test";
}

function sampleArgs(operation: OperationDefinition): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of operation.inputSchema.required ?? []) {
    const property = operation.inputSchema.properties?.[name];
    if (property) result[name] = sampleValue(property);
  }
  return result;
}

function firstOperation(model: UniversalDocumentation): OperationDefinition | undefined {
  return model.operations.find((operation) => operation.inputSchema.required?.length === 0) ?? model.operations[0];
}

export class MCPServerInspector {
  async inspect(model: UniversalDocumentation): Promise<InspectorCheck[]> {
    const checks: InspectorCheck[] = [];
    const executor = new EchoToolExecutor();
    const app = await createChannelServer(model, executor, { rest: true, ws: true, mcpHttp: true });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = address.replace(/\/$/, "");

    try {
      log("Testing HTTP health endpoint.");
      const health = await fetch(baseUrl + "/health");
      const healthBody = await health.json() as { status?: string; tools?: number };
      checks.push({
        channel: "rest",
        name: "GET /health",
        passed: health.status === 200 && healthBody.status === "ok",
        details: "HTTP " + health.status + ", tools=" + String(healthBody.tools ?? 0)
      });

      log("Testing REST tool discovery.");
      const catalogResponse = await fetch(baseUrl + "/api/v1/tools");
      const catalog = await catalogResponse.json() as { tools?: Array<{ name: string }> };
      checks.push({
        channel: "rest",
        name: "GET /api/v1/tools",
        passed: catalogResponse.status === 200 && (catalog.tools?.length ?? 0) === model.operations.length,
        details: "Discovered " + String(catalog.tools?.length ?? 0) + " of " + model.operations.length + " generated tools."
      });

      for (const anchor of ["client-search", "video-download", "channel-videos", "pornstar-videos"]) {
        const operation = model.operations.find((item) => item.sourceAnchor === anchor);
        if (!operation) {
          checks.push({
            channel: "rest",
            name: "priority operation " + anchor,
            passed: false,
            details: "Operation was not extracted from the documentation."
          });
          continue;
        }
        log("Testing REST " + operation.http.method + " " + operation.http.path);
        const args = sampleArgs(operation);
        const url = new URL(operation.http.path, baseUrl);
        let response: Response;
        if (operation.http.method === "GET") {
          for (const [key, value] of Object.entries(args)) {
            url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
          }
          response = await fetch(url);
        } else {
          response = await fetch(url, {
            method: operation.http.method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(args)
          });
        }
        const payload = await response.json() as { operationId?: string };
        checks.push({
          channel: "rest",
          name: operation.http.method + " " + operation.http.path,
          passed: response.status === 200 && payload.operationId === operation.id,
          details: "HTTP " + response.status + ", operationId=" + String(payload.operationId ?? "missing")
        });
      }

      if (model.channels.ws) {
        log("Testing WebSocket tools/list.");
        const wsList = await wsRequest(baseUrl.replace(/^http/, "ws") + "/ws", {
          jsonrpc: "2.0",
          id: "inspector-list",
          method: "tools/list"
        });
        const wsTools = (wsList.result as { tools?: unknown[] } | undefined)?.tools;
        checks.push({
          channel: "ws",
          name: "JSON-RPC tools/list",
          passed: Array.isArray(wsTools) && wsTools.length === model.operations.length,
          details: "WebSocket exposed " + String(wsTools?.length ?? 0) + " tools."
        });

        const operation = firstOperation(model);
        if (operation) {
          const wsCall = await wsRequest(baseUrl.replace(/^http/, "ws") + "/ws", {
            jsonrpc: "2.0",
            id: "inspector-call",
            method: "tools/call",
            params: { name: operation.toolName, arguments: sampleArgs(operation) }
          });
          checks.push({
            channel: "ws",
            name: "JSON-RPC tools/call",
            passed: wsCall.result !== undefined,
            details: "Called " + operation.toolName + " over WebSocket."
          });
        }
      }

      if (model.channels.mcpHttp) {
        log("Testing MCP Streamable HTTP transport.");
        const client = new Client({ name: "docs2mcp-inspector", version: "0.1.0" });
        const transport = new StreamableHTTPClientTransport(new URL(baseUrl + "/mcp"));
        try {
          await client.connect(transport);
          const listed = await client.listTools();
          checks.push({
            channel: "mcp-http",
            name: "MCP tools/list",
            passed: listed.tools.length === model.operations.length,
            details: "MCP listed " + listed.tools.length + " tools."
          });
          const operation = firstOperation(model);
          if (operation) {
            const called = await client.callTool({
              name: operation.toolName,
              arguments: sampleArgs(operation)
            });
            checks.push({
              channel: "mcp-http",
              name: "MCP tools/call",
              passed: !called.isError,
              details: "Called " + operation.toolName + " over Streamable HTTP."
            });
          }
        } catch (error) {
          checks.push({
            channel: "mcp-http",
            name: "MCP handshake and tools",
            passed: false,
            details: error instanceof Error ? error.message : String(error)
          });
        } finally {
          await client.close().catch(() => undefined);
        }
      }

      if (model.channels.stdio) {
        log("Testing MCP stdio with a spawned local server process.");
        const isTypeScript = import.meta.url.endsWith(".ts");
        const scriptUrl = new URL("../testing/stdio-harness." + (isTypeScript ? "ts" : "js"), import.meta.url);
        const scriptPath = fileURLToPath(scriptUrl);
        const environment = {
          ...getDefaultEnvironment(),
          DOCS2MCP_INSPECTOR_MODEL: JSON.stringify(model)
        };
        const stdioClient = new Client({ name: "docs2mcp-stdio-inspector", version: "0.1.0" });
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: isTypeScript ? ["--import", "tsx", scriptPath] : [scriptPath],
          env: environment,
          stderr: "pipe"
        });
        try {
          await stdioClient.connect(transport);
          const listed = await stdioClient.listTools();
          const operation = firstOperation(model);
          const called = operation
            ? await stdioClient.callTool({ name: operation.toolName, arguments: sampleArgs(operation) })
            : undefined;
          checks.push({
            channel: "stdio",
            name: "stdio tools/list and tools/call",
            passed: listed.tools.length === model.operations.length && (called === undefined || !called.isError),
            details: "Spawned stdio server; listed " + listed.tools.length + " tools."
          });
        } catch (error) {
          checks.push({
            channel: "stdio",
            name: "stdio process handshake",
            passed: false,
            details: error instanceof Error ? error.message : String(error)
          });
        } finally {
          await stdioClient.close().catch(() => undefined);
        }
      }
    } catch (error) {
      checks.push({
        channel: "rest",
        name: "inspector runtime",
        passed: false,
        details: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await app.close();
    }

    for (const check of checks) {
      log((check.passed ? "PASS " : "FAIL ") + check.channel + " / " + check.name + " — " + check.details);
    }
    return checks;
  }
}