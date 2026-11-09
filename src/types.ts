export type DocumentationSystem =
  | "mintlify"
  | "docsify"
  | "hugo"
  | "mkdocs"
  | "docusaurus"
  | "custom-html"
  | "unknown";

export type JsonSchema = {
  $schema?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | JsonSchema;
  readOnly?: boolean;
  writeOnly?: boolean;
  "x-source-type"?: string;
  "x-source-default"?: string;
};

export interface DocumentationClassification {
  system: DocumentationSystem;
  confidence: number;
  detectedBy: string;
  signals: string[];
}

export interface NavigationItem {
  title: string;
  url: string;
  anchor?: string;
  section?: string;
  parent?: string;
  depth: number;
}

export interface DocumentPage {
  title: string;
  url: string;
  anchor?: string;
  content: string;
  contentType?: string;
}

export interface ParameterDefinition {
  name: string;
  description: string;
  sourceType: string;
  required: boolean;
  schema: JsonSchema;
  defaultValue?: unknown;
}

export interface HttpBinding {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
}

export interface OperationDefinition {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  sourceAnchor: string;
  owner?: string;
  sourceMethod: string;
  returnType?: string;
  asynchronous: boolean;
  parameters: ParameterDefinition[];
  inputSchema: JsonSchema;
  toolName: string;
  upstreamAliases: string[];
  http: HttpBinding;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
  };
}

export interface UniversalDocumentation {
  schemaVersion: "1.0.0";
  generatedAt: string;
  source: {
    url: string;
    title: string;
    version?: string;
    description: string;
    system: DocumentationSystem;
    classification: DocumentationClassification;
    kind: "http-api" | "sdk" | "hybrid" | "unknown";
    language?: string;
    upstream?: {
      protocol: "mcp";
      url: string;
      discoveredFrom: string;
    };
  };
  navigation: NavigationItem[];
  pages: DocumentPage[];
  operations: OperationDefinition[];
  channels: {
    rest: boolean;
    ws: boolean;
    stdio: boolean;
    mcpHttp: boolean;
  };
}

export interface MCPForgerConfig {
  url: string;
  system?: DocumentationSystem;
  outputDir?: string;
  channels?: Partial<UniversalDocumentation["channels"]>;
  runServer?: boolean;
  inspect?: boolean;
  maxPages?: number;
  timeoutMs?: number;
  upstream?: {
    url?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  };
  server?: {
    host?: string;
    port?: number;
  };
}

export interface AnalyzedPage {
  url: string;
  html: string;
  title: string;
  description: string;
  contentType: string;
}

export interface RawOperation {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  sourceAnchor: string;
  owner?: string;
  sourceMethod: string;
  returnType?: string;
  asynchronous: boolean;
  parameters: ParameterDefinition[];
}

export interface ExtractedDocumentation {
  title: string;
  version?: string;
  description: string;
  language?: string;
  kind: "http-api" | "sdk" | "hybrid" | "unknown";
  navigation: NavigationItem[];
  pages: DocumentPage[];
  operations: RawOperation[];
  upstream?: {
    protocol: "mcp";
    url: string;
    discoveredFrom: string;
  };
}

export interface ToolExecutor {
  execute(operation: OperationDefinition, args: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void>;
}

export interface InspectorCheck {
  channel: "rest" | "ws" | "mcp-http" | "stdio";
  name: string;
  passed: boolean;
  details: string;
}

export interface GenerationResult {
  model: UniversalDocumentation;
  outputDir: string;
  files: string[];
  inspection: InspectorCheck[];
}