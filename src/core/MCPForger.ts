import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DocsAnalyzer } from "./DocsAnalyzer.js";
import { DocsClassifier } from "./DocsClassifier.js";
import { DocsForger } from "./DocsForger.js";
import { MCPSchemaForger } from "./MCPSchemaForger.js";
import { DocsShaperFactory } from "../shapers/DocsShaperFactory.js";
import type { GenerationResult, MCPForgerConfig } from "../types.js";
import { MCPServerInspector } from "./MCPServerInspector.js";
import { Docs2MCPFinisher } from "./Docs2MCPFinisher.js";

export class MCPForger {
  private readonly classifier = new DocsClassifier();
  private readonly docsForger = new DocsForger();
  private readonly shaper = new DocsShaperFactory();
  private readonly schemaForger = new MCPSchemaForger();
  private readonly inspector = new MCPServerInspector();

  async forge(config: MCPForgerConfig): Promise<GenerationResult> {
    if (!config.url) throw new Error("MCPForger requires a documentation URL.");
    const analyzer = new DocsAnalyzer({ timeoutMs: config.timeoutMs });
    const finisher = new Docs2MCPFinisher(
      config.runServer === true && config.channels?.stdio !== false
        ? (line) => console.error(line)
        : (line) => console.log(line)
    );
    finisher.log("DocsAnalyzer: GET " + config.url);
    const page = await analyzer.analyze(config.url);

    finisher.log("DocsClassifier: identifying documentation system.");
    const classification = this.classifier.classify(page.html, config.system);
    finisher.log(
      "Detected " + classification.system +
      " with confidence " + Math.round(classification.confidence * 100) + "% (" +
      classification.detectedBy + ")."
    );

    finisher.log("DocsForger: extracting sidebar navigation and method contracts.");
    const extracted = await this.docsForger.forge(
      page,
      classification.system,
      (url) => analyzer.fetchPage(url),
      config.maxPages ?? 100
    );

    finisher.log(
      "DocsExtractor: found " + extracted.navigation.length +
      " navigation links, " + extracted.pages.length +
      " pages and " + extracted.operations.length + " operations."
    );

    const model = this.shaper.shape(extracted, page.url, classification, config.channels);
    const outputDir = resolve(config.outputDir ?? "docs2mcp-generated");
    const generatedFiles = await this.schemaForger.forge(model, { outputDir, config });
    const files = generatedFiles.map((file) => file.path);

    const inspection = config.inspect === false ? [] : await this.inspector.inspect(model);
    if (config.inspect !== false && inspection.some((check) => !check.passed)) {
      finisher.log("Warning: one or more generated channel integration checks failed.");
    }

    finisher.finish(model, outputDir, files, inspection);

    if (config.runServer === true) {
      finisher.log("Docs2MCPFinisher: starting generated server.");
      await import("../runtime/index.js").then((runtime) =>
        runtime.runFromConfig(pathToFileURL(resolve(outputDir, "docs2mcp.config.json")))
      );
    }

    return { model, outputDir, files, inspection };
  }
}