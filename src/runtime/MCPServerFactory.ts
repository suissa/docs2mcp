import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { JsonSchema, OperationDefinition, ToolExecutor, UniversalDocumentation } from "../types.js";

function toZod(schema: JsonSchema): z.ZodType {
  if (schema.anyOf && schema.anyOf.length >= 2) {
    const variants = schema.anyOf.map((item) => toZod(item));
    return z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  if (schema.oneOf && schema.oneOf.length >= 2) {
    const variants = schema.oneOf.map((item) => toZod(item));
    return z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  if (Array.isArray(schema.type)) {
    const variants = schema.type.map((type) => toZod({ ...schema, type }));
    return z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  switch (schema.type) {
    case "string": {
      if (schema.enum && schema.enum.every((value) => typeof value === "string") && schema.enum.length > 0) {
        return z.enum(schema.enum as [string, ...string[]]).describe(schema.description ?? "");
      }
      return z.string().describe(schema.description ?? "");
    }
    case "integer":
      return z.number().int().describe(schema.description ?? "");
    case "number":
      return z.number().describe(schema.description ?? "");
    case "boolean":
      return z.boolean().describe(schema.description ?? "");
    case "null":
      return z.null();
    case "array":
      return z.array(schema.items ? toZod(schema.items) : z.unknown()).describe(schema.description ?? "");
    case "object": {
      const shape: Record<string, z.ZodType> = {};
      const required = new Set(schema.required ?? []);
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        const parsed = toZod(property);
        shape[key] = required.has(key) ? parsed : parsed.optional();
      }
      if (Object.keys(shape).length === 0) {
        return z.record(z.string(), z.unknown()).describe(schema.description ?? "");
      }
      const object = z.object(shape);
      return schema.additionalProperties === false ? object.strict() : object.passthrough();
    }
    default:
      return z.unknown().describe(schema.description ?? "");
  }
}

export function jsonSchemaToZod(schema: JsonSchema): z.ZodType {
  return toZod(schema);
}

export function createMcpServer(
  model: UniversalDocumentation,
  executor: ToolExecutor
): McpServer {
  const server = new McpServer({
    name: "docs2mcp-" + model.source.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    version: model.source.version ?? "1.0.0"
  });

  for (const operation of model.operations) {
    server.registerTool(
      operation.toolName,
      {
        title: operation.title,
        description: operation.description || ("Generated from " + operation.sourceUrl),
        inputSchema: jsonSchemaToZod(operation.inputSchema),
        annotations: operation.annotations
      },
      async (args) => {
        try {
          const result = await executor.execute(operation, args as Record<string, unknown>);
          const structured = result !== null && typeof result === "object" && !Array.isArray(result)
            ? result as Record<string, unknown>
            : undefined;
          return structured
            ? {
                content: [{ type: "text" as const, text: JSON.stringify(structured) }],
                structuredContent: structured
              }
            : { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error)
            }],
            isError: true
          };
        }
      }
    );
  }

  return server;
}

export function sampleArguments(operation: OperationDefinition): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const properties = operation.inputSchema.properties ?? {};
  for (const name of operation.inputSchema.required ?? []) {
    const property = properties[name];
    if (!property) continue;
    if (property.anyOf?.[0]) {
      args[name] = sampleValue(property.anyOf[0]);
    } else {
      args[name] = sampleValue(property);
    }
  }
  return args;
}

function sampleValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === "string") return "docs2mcp-test";
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return false;
  if (schema.type === "array") return [];
  if (schema.type === "object") return {};
  if (schema.anyOf?.[0]) return sampleValue(schema.anyOf[0]);
  return null;
}