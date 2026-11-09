import type {
  DocumentationClassification,
  ExtractedDocumentation,
  JsonSchema,
  OperationDefinition,
  UniversalDocumentation
} from "../types.js";
import { ToolNameHeuristic } from "../core/ToolNameHeuristic.js";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function restBinding(toolName: string): { method: "GET" | "POST"; path: string } {
  const action = toolName.replace(/^xvideos_/, "");
  const known: Record<string, { method: "GET" | "POST"; path: string }> = {
    search_videos: { method: "GET", path: "/api/v1/xvideos/search" },
    download_video: { method: "POST", path: "/api/v1/xvideos/videos/download" },
    get_channel_videos: { method: "GET", path: "/api/v1/xvideos/channels/videos" },
    get_pornstar_videos: { method: "GET", path: "/api/v1/xvideos/pornstars/videos" },
    get_video: { method: "GET", path: "/api/v1/xvideos/videos" },
    get_playlist: { method: "GET", path: "/api/v1/xvideos/playlists" },
    get_pornstar: { method: "GET", path: "/api/v1/xvideos/pornstars" },
    get_channel: { method: "GET", path: "/api/v1/xvideos/channels" },
    get_account: { method: "POST", path: "/api/v1/xvideos/account" },
    get_video_author: { method: "GET", path: "/api/v1/xvideos/videos/author" },
    get_video_pornstars: { method: "GET", path: "/api/v1/xvideos/videos/pornstars" }
  };
  if (known[action]) return known[action];
  const method = action.includes("download") || action.includes("create") || action.includes("delete") ? "POST" : "GET";
  return { method, path: "/api/v1/" + slug(toolName.replace(/^[^_]+_/, "")).replace(/_/g, "/") };
}

function buildInputSchema(operation: ExtractedDocumentation["operations"][number]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const parameter of operation.parameters) {
    properties[parameter.name] = parameter.schema;
    if (parameter.required) required.push(parameter.name);
  }
  return {
    type: "object",
    title: operation.title,
    description: operation.description,
    properties,
    required,
    additionalProperties: false
  };
}

export class UniversalDocsShaper {
  private readonly names = new ToolNameHeuristic();

  shape(
    extracted: ExtractedDocumentation,
    sourceUrl: string,
    classification: DocumentationClassification,
    channels: Partial<UniversalDocumentation["channels"]> = {}
  ): UniversalDocumentation {
    const sourceName = slug(extracted.title.replace(/\bAPI\b/ig, "").trim()) || new URL(sourceUrl).hostname.split(".")[0] || "docs";
    const operations: OperationDefinition[] = extracted.operations.map((raw) => {
      const toolName = this.names.derive(sourceName, raw);
      const http = restBinding(toolName);
      return {
        ...raw,
        toolName,
        upstreamAliases: this.names.aliases(raw, toolName),
        inputSchema: buildInputSchema(raw),
        http,
        annotations: {
          readOnlyHint: http.method === "GET",
          destructiveHint: http.method !== "GET",
          idempotentHint: http.method === "GET"
        }
      };
    });

    const source: UniversalDocumentation["source"] = {
      url: sourceUrl,
      title: extracted.title,
      description: extracted.description,
      system: classification.system,
      classification,
      kind: extracted.kind
    };
    if (extracted.version) source.version = extracted.version;
    if (extracted.language) source.language = extracted.language;
    if (extracted.upstream) source.upstream = extracted.upstream;

    return {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      source,
      navigation: extracted.navigation,
      pages: extracted.pages,
      operations,
      channels: {
        rest: channels.rest ?? true,
        ws: channels.ws ?? true,
        stdio: channels.stdio ?? true,
        mcpHttp: channels.mcpHttp ?? true
      }
    };
  }
}

export class CustomHtmlDocsShaper extends UniversalDocsShaper {}
export class MintlifyDocsShaper extends UniversalDocsShaper {}
export class DocsifyDocsShaper extends UniversalDocsShaper {}
export class HugoDocsShaper extends UniversalDocsShaper {}
export class MkDocsDocsShaper extends UniversalDocsShaper {}
export class DocusaurusDocsShaper extends UniversalDocsShaper {}