import type { OperationDefinition, ToolExecutor } from "../types.js";

export class EchoToolExecutor implements ToolExecutor {
  async execute(operation: OperationDefinition, args: Record<string, unknown>): Promise<unknown> {
    return {
      operationId: operation.id,
      toolName: operation.toolName,
      arguments: args
    };
  }
}