import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MCPForgerConfig, UniversalDocumentation } from "../types.js";
import type { GenerationFile } from "./types.js";

export interface SchemaForgeOptions {
  outputDir: string;
  config: MCPForgerConfig;
}

export class MCPSchemaForger {
  async forge(model: UniversalDocumentation, options: SchemaForgeOptions): Promise<GenerationFile[]> {
    const outputDir = resolve(options.outputDir);
    await mkdir(outputDir, { recursive: true });

    const runtimeConfig = {
      $schema: "https://github.com/suissa/docs2mcp/schema/docs2mcp.config.schema.json",
      name: model.source.title,
      sourceUrl: model.source.url,
      system: model.source.system,
      modelFile: "docs2mcp.universal.json",
      channels: {
        ...model.channels,
        ...options.config.channels
      },
      upstream: {
        url: options.config.upstream?.url ?? model.source.upstream?.url,
        headers: options.config.upstream?.headers ?? {},
        timeoutMs: options.config.upstream?.timeoutMs ?? 30_000
      },
      server: {
        host: options.config.server?.host ?? "127.0.0.1",
        port: options.config.server?.port ?? 8787
      },
      runServer: options.config.runServer ?? false,
      inspector: options.config.inspect ?? true
    };

    const packageJson = {
      name: "generated-" + model.source.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      private: true,
      type: "module",
      scripts: {
        build: "tsc -p tsconfig.json",
        start: "node dist/server.js",
        dev: "tsx server.ts"
      },
      dependencies: {
        docs2mcp: "github:suissa/docs2mcp#main"
      },
      devDependencies: {
        "@types/node": "^24.10.0",
        typescript: "^6.0.0",
        tsx: "^4.20.6"
      }
    };

    const tsconfig = {
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2023", "DOM"],
        types: ["node"],
        strict: true,
        noImplicitOverride: true,
        noImplicitReturns: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: "dist",
        rootDir: "."
      },
      include: ["server.ts"]
    };

    const serverTs = [
      'import { runFromConfig } from "docs2mcp/runtime";',
      'import { fileURLToPath } from "node:url";',
      'const configPath = fileURLToPath(new URL("./docs2mcp.config.json", import.meta.url));',
      'await runFromConfig(configPath);',
      ""
    ].join("\n");

    const universal = JSON.stringify(model, null, 2) + "\n";
    const configJson = JSON.stringify(runtimeConfig, null, 2) + "\n";
    const schema = JSON.stringify(model.operations.map((operation) => ({
      name: operation.toolName,
      inputSchema: operation.inputSchema,
      http: operation.http,
      source: operation.sourceUrl
    })), null, 2) + "\n";

    const files: GenerationFile[] = [
      { path: "docs2mcp.universal.json", content: universal },
      { path: "docs2mcp.config.json", content: configJson },
      { path: "tools.schema.json", content: schema },
      { path: "package.json", content: JSON.stringify(packageJson, null, 2) + "\n" },
      { path: "tsconfig.json", content: JSON.stringify(tsconfig, null, 2) + "\n" },
      { path: "server.ts", content: serverTs }
    ];

    for (const file of files) {
      const destination = resolve(outputDir, file.path);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }

    return files;
  }
}