import { createMcpServer } from "../runtime/MCPServerFactory.js";
import { EchoToolExecutor } from "../runtime/Executor.js";
import type { UniversalDocumentation } from "../types.js";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const serialized = process.env.DOCS2MCP_INSPECTOR_MODEL;
if (!serialized) throw new Error("DOCS2MCP_INSPECTOR_MODEL is required.");
const model = JSON.parse(serialized) as UniversalDocumentation;
await serveStdio(() => createMcpServer(model, new EchoToolExecutor()));