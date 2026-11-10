import websocket from "@fastify/websocket";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import type { JsonSchema, OperationDefinition, ToolExecutor, UniversalDocumentation } from "../types.js";
import { createMcpServer, jsonSchemaToZod } from "./MCPServerFactory.js";

export interface ChannelServerOptions {
  rest?: boolean;
  ws?: boolean;
  mcpHttp?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function coerceQueryValue(value: unknown, schema: JsonSchema | undefined): unknown {
  if (typeof value !== "string" || !schema) return value;
  if (schema.type === "integer" || schema.type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (schema.type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (schema.type === "object" || schema.type === "array") {
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
  return value;
}

function parseArguments(operation: OperationDefinition, input: Record<string, unknown>): Record<string, unknown> {
  const properties = operation.inputSchema.properties ?? {};
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) normalized[key] = coerceQueryValue(value, properties[key]);
  const parsed = jsonSchemaToZod(operation.inputSchema).safeParse(normalized);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "));
  return parsed.data as Record<string, unknown>;
}

function resultForRest(result: unknown): unknown {
  if (result && typeof result === "object" && "structuredContent" in result) return (result as { structuredContent: unknown }).structuredContent;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: Array<{ type?: string; text?: string }> }).content;
    const text = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    try { return JSON.parse(text) as unknown; } catch { return { result: text }; }
  }
  return result;
}

function operationResponse(operation: OperationDefinition): Record<string, unknown> {
  return {
    name: operation.toolName,
    title: operation.title,
    description: operation.description,
    method: operation.http.method,
    path: operation.http.path,
    inputSchema: operation.inputSchema
  };
}

function sendWs(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

async function handleWsMessage(socket: WebSocket, raw: RawData, model: UniversalDocumentation, executor: ToolExecutor): Promise<void> {
  let request: { id?: string | number | null; method?: string; params?: Record<string, unknown> };
  try {
    request = JSON.parse(raw.toString()) as typeof request;
  } catch {
    sendWs(socket, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } });
    return;
  }
  const id = request.id ?? null;
  try {
    if (request.method === "tools/list") {
      sendWs(socket, { jsonrpc: "2.0", id, result: { tools: model.operations.map(operationResponse) } });
      return;
    }
    if (request.method === "tools/call") {
      const params = record(request.params);
      const name = typeof params.name === "string" ? params.name : "";
      const operation = model.operations.find((item) => item.toolName === name);
      if (!operation) throw new Error("Unknown tool: " + name);
      const output = await executor.execute(operation, parseArguments(operation, record(params.arguments)));
      sendWs(socket, {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: record(output) }
      });
      return;
    }
    throw new Error("Unsupported WebSocket method: " + String(request.method));
  } catch (error) {
    sendWs(socket, { jsonrpc: "2.0", id, error: { code: -32602, message: error instanceof Error ? error.message : String(error) } });
  }
}

export async function createChannelServer(
  model: UniversalDocumentation,
  executor: ToolExecutor,
  options: ChannelServerOptions = {}
): Promise<FastifyInstance> {
  const app = createMcpFastifyApp();
  await app.register(websocket);

  app.get("/health", async () => ({
    status: "ok",
    name: "docs2mcp",
    source: model.source.title,
    system: model.source.system,
    tools: model.operations.length
  }));
  app.get("/api/v1/tools", async () => ({ tools: model.operations.map(operationResponse) }));
  app.get("/openapi.json", async () => buildOpenApiDocument(model));

  if (options.rest !== false) {
    for (const operation of model.operations) {
      app.route({
        method: operation.http.method,
        url: operation.http.path,
        handler: async (request, reply) => {
          try {
            const bodyInput = record(request.body);
            const pathInput = record(request.params);
            const queryInput = record(request.query);
            const input = operation.sourceHttp
              ? { ...pathInput, ...queryInput, ...(operation.parameters.some((parameter) => parameter.location === "body") ? { body: bodyInput } : bodyInput) }
              : { ...queryInput, ...bodyInput };
            const args = parseArguments(operation, input);
            return reply.code(200).send(resultForRest(await executor.execute(operation, args)));
          } catch (error) {
            return reply.code(400).send({
              error: "invalid_request",
              message: error instanceof Error ? error.message : String(error),
              tool: operation.toolName
            });
          }
        }
      });
    }
  }

  if (options.ws !== false) {
    app.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", (raw) => { void handleWsMessage(socket, raw, model, executor); });
    });
  }

  if (options.mcpHttp !== false) {
    const mcpHandler = createMcpHandler(() => createMcpServer(model, executor));
    const nodeHandler = toNodeHandler(mcpHandler);
    app.all("/mcp", (request, reply) =>
      nodeHandler(
        request.raw as Parameters<typeof nodeHandler>[0],
        reply.raw as Parameters<typeof nodeHandler>[1],
        request.body
      )
    );
  }

  return app;
}

export function buildOpenApiDocument(model: UniversalDocumentation): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const operation of model.operations) {
    const pathItem = (paths[operation.http.path] ?? {}) as Record<string, unknown>;
    const schema = operation.inputSchema;
    const request: Record<string, unknown> = {
      operationId: operation.toolName,
      summary: operation.title,
      description: operation.description,
      responses: { "200": { description: "Operation result" }, "400": { description: "Invalid input" } }
    };
    if (operation.http.method === "GET") {
      request.parameters = Object.entries(schema.properties ?? {}).map(([name, property]) => ({
        name,
        in: "query",
        required: (schema.required ?? []).includes(name),
        description: property.description,
        schema: property
      }));
    } else {
      request.requestBody = { required: true, content: { "application/json": { schema } } };
    }
    pathItem[operation.http.method.toLowerCase()] = request;
    paths[operation.http.path] = pathItem;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: model.source.title + " REST API",
      version: model.source.version ?? "1.0.0",
      description: "Generated by docs2mcp from " + model.source.url
    },
    servers: [{ url: "http://127.0.0.1:8787" }],
    paths
  };
}