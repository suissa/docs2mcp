import { load } from "cheerio";
import { parse as parseYaml } from "yaml";
import type {
  AnalyzedPage,
  ApiDocumentationMetadata,
  ExtractedDocumentation,
  JsonSchema,
  HttpMethod,
  ParameterDefinition,
  RawOperation,
  SourceDocument,
  SourceHttpBinding
} from "../types.js";

export interface OpenApiExtractorInput {
  page: AnalyzedPage;
  extracted: ExtractedDocumentation;
  fetchPage: (url: string) => Promise<AnalyzedPage>;
  maxSpecs?: number;
}

interface ParsedSpec {
  url: string;
  document: Record<string, unknown>;
}

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slug(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function jsonPointer(root: Record<string, unknown>, pointer: string): unknown {
  if (!pointer.startsWith("#/")) return undefined;
  const parts = pointer.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current)) current = current[Number(part)];
    else current = asRecord(current)[part];
  }
  return current;
}

function dereference(
  value: unknown,
  root: Record<string, unknown>,
  seen: Set<string> = new Set()
): unknown {
  const record = asRecord(value);
  const ref = stringValue(record.$ref);
  if (ref) {
    if (!ref.startsWith("#/") || seen.has(ref)) return {};
    const target = jsonPointer(root, ref);
    if (target === undefined) return {};
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    const resolved = asRecord(dereference(target, root, nextSeen));
    const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$ref"));
    return { ...resolved, ...siblings };
  }

  if (Array.isArray(value)) return value.map((item) => dereference(item, root, seen));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, dereference(item, root, seen)])
  );
}

function toJsonSchema(schemaValue: unknown, root: Record<string, unknown>, depth = 0): JsonSchema {
  if (depth > 20) return {};
  const schema = asRecord(dereference(schemaValue, root));
  const result: JsonSchema = {};
  const scalars = [
    "title", "description", "type", "format", "pattern", "default", "minimum", "maximum",
    "minLength", "maxLength", "minItems", "maxItems", "readOnly", "writeOnly", "nullable",
    "const", "enum"
  ] as const;

  for (const key of scalars) {
    const value = schema[key];
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }
  if (schema.properties !== undefined) {
    result.properties = Object.fromEntries(
      Object.entries(asRecord(schema.properties)).map(([key, item]) => [key, toJsonSchema(item, root, depth + 1)])
    );
  }
  if (Array.isArray(schema.required)) {
    result.required = schema.required.filter((item): item is string => typeof item === "string");
  }
  if (schema.items !== undefined) result.items = toJsonSchema(schema.items, root, depth + 1);
  if (schema.additionalProperties !== undefined) {
    result.additionalProperties = typeof schema.additionalProperties === "boolean"
      ? schema.additionalProperties
      : toJsonSchema(schema.additionalProperties, root, depth + 1);
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = asArray(schema[keyword]);
    if (variants.length > 0) result[keyword] = variants.map((item) => toJsonSchema(item, root, depth + 1));
  }
  if (typeof schema.type === "string" && schema.nullable === true) {
    result.anyOf = [...(result.anyOf ?? [{ type: schema.type }]), { type: "null" }];
    delete result.type;
  }
  return result;
}

function firstJsonContent(contentValue: unknown): { mediaType: string; schema: unknown } | undefined {
  const content = asRecord(contentValue);
  const candidates = Object.entries(content);
  const selected = candidates.find(([mediaType]) => mediaType === "application/json")
    ?? candidates.find(([mediaType]) => mediaType.endsWith("+json"))
    ?? candidates.find(([mediaType]) => mediaType.startsWith("application/"));
  if (!selected) return undefined;
  const [mediaType, media] = selected;
  const schema = asRecord(media).schema;
  return schema === undefined ? undefined : { mediaType, schema };
}

function parameterFromOpenApi(
  parameterValue: unknown,
  root: Record<string, unknown>
): ParameterDefinition | undefined {
  const parameter = asRecord(dereference(parameterValue, root));
  const name = stringValue(parameter.name);
  const location = stringValue(parameter.in);
  if (!name || !location || !["path", "query", "header", "cookie"].includes(location)) return undefined;

  let schema: JsonSchema;
  if (parameter.schema !== undefined) {
    schema = toJsonSchema(parameter.schema, root);
  } else {
    const content = firstJsonContent(parameter.content);
    schema = content ? toJsonSchema(content.schema, root) : {};
  }
  const definition: ParameterDefinition = {
    name,
    description: stringValue(parameter.description) ?? "",
    sourceType: typeof schema.type === "string" ? schema.type : "unknown",
    required: parameter.required === true || location === "path",
    schema,
    location: location as ParameterDefinition["location"]
  };
  if (schema.default !== undefined) definition.defaultValue = schema.default;
  return definition;
}

function requestBodyFromValue(
  bodyValue: unknown,
  root: Record<string, unknown>
): { parameter?: ParameterDefinition; required: boolean; mediaType?: string } {
  const requestBody = asRecord(dereference(bodyValue, root));
  const selected = firstJsonContent(requestBody.content);
  if (!selected) return { required: requestBody.required === true };
  const schema = toJsonSchema(selected.schema, root);
  const parameter: ParameterDefinition = {
    name: "body",
    description: stringValue(requestBody.description) ?? "JSON request body.",
    sourceType: typeof schema.type === "string" ? schema.type : "object",
    required: requestBody.required === true,
    schema,
    location: "body"
  };
  return {
    parameter,
    required: requestBody.required === true,
    mediaType: selected.mediaType
  };
}

function responseSchema(
  responsesValue: unknown,
  root: Record<string, unknown>
): JsonSchema | undefined {
  const responses = asRecord(responsesValue);
  const successCodes = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort((left, right) => Number(left) - Number(right));
  const selectedCode = successCodes[0] ?? "default";
  const response = asRecord(dereference(responses[selectedCode], root));
  const selected = firstJsonContent(response.content);
  return selected ? toJsonSchema(selected.schema, root) : undefined;
}

function normalizeServers(spec: Record<string, unknown>, pageUrl: string): string | undefined {
  const firstServer = asRecord(asArray(spec.servers)[0]);
  const serverUrl = stringValue(firstServer.url);
  if (serverUrl) {
    try {
      return new URL(serverUrl, pageUrl).toString().replace(/\/$/, "");
    } catch {
      return undefined;
    }
  }
  const swaggerHost = stringValue(spec.host);
  if (swaggerHost) {
    const schemes = asArray(spec.schemes).filter((item): item is string => typeof item === "string");
    const scheme = schemes[0] ?? new URL(pageUrl).protocol.slice(0, -1);
    return (scheme + "://" + swaggerHost + (stringValue(spec.basePath) ?? "")).replace(/\/$/, "");
  }
  return undefined;
}

function securitySchemeMap(spec: Record<string, unknown>): Record<string, unknown> {
  const openApiSchemes = asRecord(asRecord(spec.components).securitySchemes);
  const swaggerSchemes = asRecord(spec.securityDefinitions);
  return Object.keys(openApiSchemes).length > 0 ? openApiSchemes : swaggerSchemes;
}

function collectSecurityNames(operation: Record<string, unknown>, spec: Record<string, unknown>): string[] {
  const requirements = operation.security ?? spec.security;
  const names = new Set<string>();
  for (const requirement of asArray(requirements)) {
    for (const name of Object.keys(asRecord(requirement))) names.add(name);
  }
  return [...names];
}

function parseOpenApiDocument(source: string, url: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    try {
      parsed = parseYaml(source) as unknown;
    } catch {
      return undefined;
    }
  }
  const document = asRecord(parsed);
  if (!document.openapi && !document.swagger) return undefined;
  if (Object.keys(asRecord(document.paths)).length === 0) return undefined;
  return { ...document, __docs2mcp_spec_url: url };
}

function parseBalancedObject(source: string, start: number): Record<string, unknown> | undefined {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? "";
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return asRecord(JSON.parse(source.slice(start, cursor + 1)) as unknown);
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function parseJsonString(source: string, start: number): string | undefined {
  let escaped = false;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? "";
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') {
      try {
        return JSON.parse(source.slice(start, cursor + 1)) as string;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function parseEncodedObjectAfterKey(source: string, key: string): Record<string, unknown> | undefined {
  const index = source.indexOf(key);
  if (index < 0) return undefined;
  const colon = source.indexOf(":", index + key.length);
  if (colon < 0) return undefined;
  let valueStart = colon + 1;
  while (/\s/.test(source[valueStart] ?? "")) valueStart += 1;

  if (source[valueStart] === "{") return parseBalancedObject(source, valueStart);
  if (source[valueStart] === '"') {
    const decoded = parseJsonString(source, valueStart);
    if (!decoded) return undefined;
    try {
      return asRecord(JSON.parse(decoded) as unknown);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function mintlifyReferenceFromHtml(html: string): Record<string, unknown> | undefined {
  const parsed = parseEncodedObjectAfterKey(html, "openApiReferenceData");
  if (parsed) return parsed;
  const $ = load(html);
  let found: Record<string, unknown> | undefined;
  $("script[type='application/json'], script#__NEXT_DATA__").each((_index, element) => {
    if (found) return;
    const embedded = parseEncodedObjectAfterKey($(element).text(), "openApiReferenceData");
    if (embedded) found = embedded;
  });
  return found;
}

function mintlifySecurity(reference: Record<string, unknown>): Record<string, unknown> {
  const schemes: Record<string, unknown> = {};
  const options = asArray(asRecord(reference.dependencies).processedSecurityOptions);
  for (const option of options) {
    for (const entry of asArray(asRecord(option).schemes)) {
      const record = asRecord(entry);
      const name = stringValue(record.schemeName);
      if (name && record.scheme !== undefined) schemes[name] = record.scheme;
    }
  }
  return schemes;
}

function embeddedMintlifyOperation(
  reference: Record<string, unknown>,
  pageUrl: string
): RawOperation | undefined {
  const operation = asRecord(reference.operation);
  const dependencies = asRecord(reference.dependencies);
  const methodText = stringValue(operation.method)?.toUpperCase();
  const method = HTTP_METHODS.find((candidate) => candidate === methodText);
  const path = stringValue(operation.path);
  if (!method || !path) return undefined;

  const parameters: ParameterDefinition[] = [];
  for (const value of Object.values(asRecord(dependencies.parameters))) {
    const parameter = asRecord(value);
    const name = stringValue(parameter.name);
    const location = stringValue(parameter.in);
    if (!name || !location || !["path", "query", "header", "cookie"].includes(location)) continue;
    const schema = toJsonSchema(parameter.schema ?? parameter, reference);
    parameters.push({
      name,
      description: stringValue(parameter.description) ?? "",
      sourceType: typeof schema.type === "string" ? schema.type : "unknown",
      required: parameter.required === true,
      schema,
      location: location as ParameterDefinition["location"]
    });
  }

  const requestBody = requestBodyFromValue(dependencies.requestBody, reference);
  if (requestBody.parameter) parameters.push(requestBody.parameter);

  const title = stringValue(operation.summary) ?? stringValue(operation.title) ?? method + " " + path;
  const id = stringValue(operation.operationId) ?? method.toLowerCase() + "-" + slug(path);
  const baseUrl = asArray(operation.baseUrlOptions).find((item): item is string => typeof item === "string");
  const sourceHttp: SourceHttpBinding = {
    method,
    path,
    requestBodyRequired: requestBody.required,
    security: Object.keys(mintlifySecurity(reference))
  };
  if (baseUrl) sourceHttp.baseUrl = baseUrl.replace(/\/$/, "");
  const apiOperationId = stringValue(operation.operationId);
  if (apiOperationId) sourceHttp.operationId = apiOperationId;
  if (requestBody.mediaType) sourceHttp.requestContentType = requestBody.mediaType;

  const responseDependencies = asRecord(dependencies.responses);
  const responseReferences = asRecord(operation.responses);
  const successId = Object.entries(responseReferences)
    .filter(([code]) => /^2\d\d$/.test(code))
    .sort(([left], [right]) => Number(left) - Number(right))[0]?.[1];
  const responseValue = successId === undefined ? undefined : responseDependencies[String(successId)];
  const responseContent = firstJsonContent(asRecord(responseValue).content);
  const outputSchema = responseContent ? toJsonSchema(responseContent.schema, reference) : undefined;

  const raw: RawOperation = {
    id,
    title,
    description: stringValue(operation.description) ?? "",
    sourceUrl: pageUrl,
    sourceAnchor: slug(id),
    sourceMethod: apiOperationId ?? method.toLowerCase() + "_" + slug(path),
    asynchronous: false,
    parameters,
    sourceHttp
  };
  if (outputSchema) raw.outputSchema = outputSchema;
  return raw;
}

function operationFromSpec(
  path: string,
  method: HttpMethod,
  pathItem: Record<string, unknown>,
  operationValue: unknown,
  spec: Record<string, unknown>,
  specUrl: string,
  baseUrl: string | undefined
): RawOperation | undefined {
  const operation = asRecord(dereference(operationValue, spec));
  if (Object.keys(operation).length === 0) return undefined;

  const byLocationAndName = new Map<string, ParameterDefinition>();
  for (const parameterValue of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
    const parameter = parameterFromOpenApi(parameterValue, spec);
    if (parameter) byLocationAndName.set(parameter.location + ":" + parameter.name, parameter);
  }
  const body = requestBodyFromValue(operation.requestBody, spec);
  if (body.parameter) byLocationAndName.set("body:body", body.parameter);

  const operationId = stringValue(operation.operationId);
  const title = stringValue(operation.summary) ?? operationId ?? (method + " " + path);
  const id = operationId ?? method.toLowerCase() + "-" + slug(path);
  const sourceHttp: SourceHttpBinding = {
    method,
    path,
    requestBodyRequired: body.required,
    security: collectSecurityNames(operation, spec)
  };
  if (baseUrl) sourceHttp.baseUrl = baseUrl;
  if (operationId) sourceHttp.operationId = operationId;
  if (body.mediaType) sourceHttp.requestContentType = body.mediaType;

  const raw: RawOperation = {
    id,
    title,
    description: stringValue(operation.description) ?? "",
    sourceUrl: specUrl,
    sourceAnchor: slug(id),
    sourceMethod: operationId ?? method.toLowerCase() + "_" + slug(path),
    asynchronous: false,
    parameters: [...byLocationAndName.values()],
    sourceHttp
  };
  const output = responseSchema(operation.responses, spec);
  if (output) raw.outputSchema = output;
  return raw;
}

function sourceSpecUrls(documents: SourceDocument[], pageUrl: string): string[] {
  const urls = new Set<string>();
  const add = (value: string, sourceUrl: string): void => {
    try {
      const candidate = new URL(value, sourceUrl);
      if ((candidate.protocol === "https:" || candidate.protocol === "http:") &&
        /\.(?:json|ya?ml)(?:[?#].*)?$/i.test(candidate.pathname + candidate.search)) {
        urls.add(candidate.toString());
      }
    } catch {
      // Ignore invalid spec references.
    }
  };

  for (const document of documents) {
    const $ = load(document.html);
    $("a[href], link[href], [data-openapi]").each((_index, element) => {
      const href = $(element).attr("href") ?? $(element).attr("data-openapi");
      if (href) add(href, document.url);
    });
    const patterns = [
      /["']openapi["']\s*:\s*["']([^"']+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi,
      /["']originalFileLocation["']\s*:\s*["']([^"']+\.(?:json|ya?ml))["']/gi
    ];
    for (const pattern of patterns) {
      for (const match of document.html.matchAll(pattern)) {
        if (match[1]) add(match[1], new URL("/", document.url).toString());
      }
    }
  }

  const root = new URL("/", pageUrl);
  for (const candidate of ["openapi.json", "openapi.yaml", "swagger.json", "swagger.yaml", "docs/openapi.json"]) {
    urls.add(new URL(candidate, root).toString());
  }
  return [...urls];
}

function operationKey(operation: RawOperation): string {
  return operation.sourceHttp
    ? operation.sourceHttp.method + " " + operation.sourceHttp.path
    : operation.id;
}

export class OpenApiDocsExtractor {
  async extract(input: OpenApiExtractorInput): Promise<ExtractedDocumentation> {
    const documents = input.extracted.sourceDocuments ?? [{ url: input.page.url, html: input.page.html }];
    const operations = [...input.extracted.operations];
    const seen = new Set(operations.map(operationKey));
    const specificationUrls: string[] = [];
    let baseUrl: string | undefined;
    let securitySchemes: Record<string, unknown> | undefined;
    const maxSpecs = input.maxSpecs ?? 8;

    for (const document of documents) {
      const reference = mintlifyReferenceFromHtml(document.html);
      if (!reference) continue;
      const operation = embeddedMintlifyOperation(reference, document.url);
      if (operation && !seen.has(operationKey(operation))) {
        operations.push(operation);
        seen.add(operationKey(operation));
      }
      const apiBaseUrl = stringValue(asRecord(reference.operation).baseUrlOptions && asArray(asRecord(reference.operation).baseUrlOptions)[0]);
      if (!baseUrl && apiBaseUrl) baseUrl = apiBaseUrl;
      const schemes = mintlifySecurity(reference);
      if (Object.keys(schemes).length > 0) securitySchemes = { ...securitySchemes, ...schemes };
    }

    for (const url of sourceSpecUrls(documents, input.page.url).slice(0, maxSpecs)) {
      if (specificationUrls.length >= maxSpecs) break;
      if (url === input.page.url) continue;
      try {
        const fetched = await input.fetchPage(url);
        const document = parseOpenApiDocument(fetched.html, fetched.url);
        if (!document) continue;
        specificationUrls.push(fetched.url);
        const serverUrl = normalizeServers(document, fetched.url);
        if (!baseUrl && serverUrl) baseUrl = serverUrl;
        const schemes = securitySchemeMap(document);
        if (Object.keys(schemes).length > 0) securitySchemes = { ...securitySchemes, ...schemes };

        for (const [path, pathItemValue] of Object.entries(asRecord(document.paths))) {
          const pathItem = asRecord(dereference(pathItemValue, document));
          for (const method of HTTP_METHODS) {
            const operationValue = pathItem[method.toLowerCase()];
            if (operationValue === undefined) continue;
            const operation = operationFromSpec(path, method, pathItem, operationValue, document, fetched.url, serverUrl);
            if (!operation || seen.has(operationKey(operation))) continue;
            operations.push(operation);
            seen.add(operationKey(operation));
          }
        }
      } catch {
        // Conventional spec locations are optional. Keep extracting other pages and specs.
      }
    }

    const api: ApiDocumentationMetadata = { specificationUrls };
    if (baseUrl) api.baseUrl = baseUrl;
    if (securitySchemes) api.securitySchemes = securitySchemes;

    const hasHttpOperations = operations.some((operation) => operation.sourceHttp !== undefined);
    const hadSdkOperations = input.extracted.operations.some((operation) => operation.sourceHttp === undefined);
    const kind = hasHttpOperations
      ? hadSdkOperations ? "hybrid" : "http-api"
      : input.extracted.kind;

    return {
      ...input.extracted,
      kind,
      operations,
      api
    };
  }
}
