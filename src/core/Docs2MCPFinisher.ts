import type { InspectorCheck, OperationDefinition, UniversalDocumentation } from "../types.js";

export class Docs2MCPFinisher {
  constructor(private readonly write: (line: string) => void = console.log) {}

  log(message: string): void {
    this.write("[docs2mcp] " + message);
  }

  finish(
    model: UniversalDocumentation,
    outputDir: string,
    files: string[],
    inspection: InspectorCheck[]
  ): void {
    this.log("Generation complete.");
    this.log("Source: " + model.source.url);
    this.log("Documentation system: " + model.source.system);
    this.log("Classification confidence: " + Math.round(model.source.classification.confidence * 100) + "%");
    this.log("Output: " + outputDir);
    this.log("Pages: " + model.pages.length + " | Navigation links: " + model.navigation.length);
    this.log("Tools: " + model.operations.length);
    for (const operation of model.operations) this.logOperation(operation);
    this.log("Channels: " + Object.entries(model.channels).filter(([, enabled]) => enabled).map(([name]) => name).join(", "));
    this.log("Generated files: " + files.join(", "));
    if (inspection.length > 0) {
      const passed = inspection.filter((check) => check.passed).length;
      this.log("Inspection: " + passed + "/" + inspection.length + " checks passed.");
      for (const check of inspection) {
        this.log((check.passed ? "PASS " : "FAIL ") + check.channel + " — " + check.name + ": " + check.details);
      }
    }
    if (model.source.upstream) {
      this.log("Discovered upstream MCP: " + model.source.upstream.url);
    }
  }

  private logOperation(operation: OperationDefinition): void {
    this.log(
      "Tool " + operation.toolName + " -> " +
      operation.http.method + " " + operation.http.path +
      " (source " + operation.sourceAnchor + ")"
    );
  }
}