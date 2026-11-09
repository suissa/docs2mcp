#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { MCPForger } from "./core/MCPForger.js";
import { runFromConfig } from "./runtime/index.js";
import type { DocumentationSystem, MCPForgerConfig } from "./types.js";

interface GenerateOptions {
  config?: string;
  output?: string;
  system?: DocumentationSystem;
  channels?: string;
  inspect?: boolean;
  run?: boolean;
  maxPages?: string;
}

async function readConfig(path: string | undefined): Promise<Partial<MCPForgerConfig>> {
  if (!path) return {};
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The configuration file must contain a JSON object.");
  }
  return parsed as Partial<MCPForgerConfig>;
}

function parseChannels(value: string | undefined): Partial<NonNullable<MCPForgerConfig["channels"]>> {
  if (!value) return {};
  const enabled = new Set(value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean));
  const valid = new Set(["rest", "ws", "stdio", "mcphttp"]);
  for (const channel of enabled) {
    if (!valid.has(channel)) throw new Error("Unknown channel: " + channel);
  }
  return {
    rest: enabled.has("rest"),
    ws: enabled.has("ws"),
    stdio: enabled.has("stdio"),
    mcpHttp: enabled.has("mcphttp")
  };
}

const program = new Command();
program
  .name("docs2mcp")
  .description("Generate MCP tools and REST/WebSocket APIs from online documentation.")
  .version("0.1.0");

program.command("generate")
  .description("Analyze a documentation site and generate its MCP server project.")
  .argument("[url]", "Documentation URL (overrides config.url)")
  .option("-c, --config <file>", "JSON configuration file")
  .option("-o, --output <directory>", "Output directory")
  .option("-s, --system <system>", "Force documentation system classifier")
  .option("--channels <list>", "Comma-separated channels: rest,ws,stdio,mcphttp")
  .option("--no-inspect", "Skip local channel integration checks")
  .option("--run", "Start the generated server when generation finishes")
  .option("--max-pages <number>", "Maximum number of linked documentation pages", "100")
  .action(async (url: string | undefined, options: GenerateOptions) => {
    const configured = await readConfig(options.config);
    const config: MCPForgerConfig = {
      ...configured,
      url: url ?? configured.url ?? "",
      maxPages: Number(options.maxPages ?? configured.maxPages ?? 100)
    };
    if (options.output !== undefined) config.outputDir = options.output;
    if (options.system !== undefined) config.system = options.system;
    if (options.channels !== undefined) config.channels = parseChannels(options.channels);
    if (options.inspect !== undefined) config.inspect = options.inspect;
    if (options.run !== undefined) config.runServer = options.run;
    if (!config.url) throw new Error("Provide a documentation URL or set url in the JSON configuration.");
    if (!Number.isInteger(config.maxPages) || (config.maxPages ?? 0) < 1) {
      throw new Error("--max-pages must be a positive integer.");
    }
    const result = await new MCPForger().forge(config);
    const summary = JSON.stringify({
      outputDir: result.outputDir,
      files: result.files,
      tools: result.model.operations.map((operation) => operation.toolName),
      system: result.model.source.system
    }, null, 2) + "\n";
    if (config.runServer === true && config.channels?.stdio !== false) {
      process.stderr.write(summary);
    } else {
      process.stdout.write(summary);
    }
  });

program.command("serve")
  .description("Start a previously generated MCP/REST/WebSocket server.")
  .argument("<config>", "Path to docs2mcp.config.json")
  .action(async (config: string) => {
    await runFromConfig(config);
  });

program.command("classify")
  .description("Analyze a documentation URL and print its detected documentation system.")
  .argument("<url>", "Documentation URL")
  .action(async (url: string) => {
    const { DocsAnalyzer } = await import("./core/DocsAnalyzer.js");
    const { DocsClassifier } = await import("./core/DocsClassifier.js");
    const page = await new DocsAnalyzer().analyze(url);
    const result = new DocsClassifier().classify(page.html);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  });

program.showHelpAfterError();
program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write("[docs2mcp] " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});