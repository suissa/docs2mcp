export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type ParameterLocation = "path" | "query" | "header" | "cookie" | "body";

export type DocumentationSystem =
  | "mintlify" | "docsify" | "hugo" | "mkdocs" | "docusaurus" | "custom-html" | "unknown";

export type JsonSchema = {
  $schema?: string; $ref?: string; title?: string; description?: string;
  type?: string | string[]; format?: string; pattern?: string; properties?: Record<string, JsonSchema>;
  required?: string[]; items?: JsonSchema; enum?: unknown[]; const?: unknown;
  anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; allOf?: JsonSchema[];
  default?: unknown; minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; additionalProperties?: boolean | JsonSchema;
  readOnly?: boolean; writeOnly?: boolean; nullable?: boolean;
  "x-source-type"?: string; "x-source-default"?: string;
};

export interface DocumentationClassification { system: DocumentationSystem; confidence: number; detectedBy: string; signals: string[]; }
export interface NavigationItem { title: string; url: string; anchor?: string; section?: string; parent?: string; depth: number; }
export interface DocumentPage { title: string; url: string; anchor?: string; content: string; contentType?: string; }
export interface ParameterDefinition {
  name: string; description: string; sourceType: string; required: boolean; schema: JsonSchema;
  location?: ParameterLocation; defaultValue?: unknown;
}
export interface HttpBinding { method: HttpMethod; path: string; }
export interface SourceHttpBinding {
  method: HttpMethod; path: string; baseUrl?: string; operationId?: string;
  requestBodyRequired?: boolean; requestContentType?: string; security?: string[];
}
export interface ApiDocumentationMetadata { baseUrl?: string; specificationUrls: string[]; securitySchemes?: Record<string, unknown>; }
export interface OperationDefinition {
  id: string; title: string; description: string; sourceUrl: string; sourceAnchor: string;
  owner?: string; sourceMethod: string; returnType?: string; asynchronous: boolean;
  parameters: ParameterDefinition[]; inputSchema: JsonSchema; toolName: string;
  upstreamAliases: string[]; http: HttpBinding; sourceHttp?: SourceHttpBinding;
  outputSchema?: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; };
}
export interface UniversalDocumentation {
  schemaVersion: "1.0.0"; generatedAt: string;
  source: {
    url: string; title: string; version?: string; description: string;
    system: DocumentationSystem; classification: DocumentationClassification;
    kind: "http-api" | "sdk" | "hybrid" | "unknown"; language?: string;
    api?: ApiDocumentationMetadata;
    upstream?: { protocol: "mcp"; url: string; discoveredFrom: string; };
  };
  navigation: NavigationItem[]; pages: DocumentPage[]; operations: OperationDefinition[];
  channels: { rest: boolean; ws: boolean; stdio: boolean; mcpHttp: boolean; };
}
export interface MCPForgerConfig {
  url: string; system?: DocumentationSystem; outputDir?: string;
  channels?: Partial<UniversalDocumentation["channels"]>; runServer?: boolean; inspect?: boolean;
  maxPages?: number; timeoutMs?: number;
  api?: { baseUrl?: string; headers?: Record<string, string>; authEnv?: Record<string, string>; timeoutMs?: number; };
  upstream?: { url?: string; headers?: Record<string, string>; timeoutMs?: number; };
  server?: { host?: string; port?: number; };
}
export interface AnalyzedPage { url: string; html: string; title: string; description: string; contentType: string; }
export interface RawOperation {
  id: string; title: string; description: string; sourceUrl: string; sourceAnchor: string;
  owner?: string; sourceMethod: string; returnType?: string; asynchronous: boolean;
  parameters: ParameterDefinition[]; outputSchema?: JsonSchema; sourceHttp?: SourceHttpBinding;
}
export interface SourceDocument { url: string; html: string; }
export interface ExtractedDocumentation {
  title: string; version?: string; description: string; language?: string;
  kind: "http-api" | "sdk" | "hybrid" | "unknown";
  navigation: NavigationItem[]; pages: DocumentPage[]; operations: RawOperation[];
  sourceDocuments?: SourceDocument[]; api?: ApiDocumentationMetadata;
  upstream?: { protocol: "mcp"; url: string; discoveredFrom: string; };
}
export interface ToolExecutor { execute(operation: OperationDefinition, args: Record<string, unknown>): Promise<unknown>; close?(): Promise<void>; }
export interface InspectorCheck { channel: "rest" | "ws" | "mcp-http" | "stdio"; name: string; passed: boolean; details: string; }
export interface GenerationResult { model: UniversalDocumentation; outputDir: string; files: string[]; inspection: InspectorCheck[]; }
