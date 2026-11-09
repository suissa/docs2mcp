import { load, type CheerioAPI } from "cheerio";
import type {
  AnalyzedPage,
  DocumentPage,
  ExtractedDocumentation,
  NavigationItem,
  ParameterDefinition,
  RawOperation
} from "../types.js";

export interface ExtractorInput {
  page: AnalyzedPage;
  fetchPage: (url: string) => Promise<AnalyzedPage>;
  maxPages: number;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourceDefault(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "None") return null;
  if (trimmed === "True") return true;
  if (trimmed === "False") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const enumMember = trimmed.match(/\.([A-Za-z][A-Za-z0-9_]*)$/);
  return enumMember?.[1] ?? trimmed;
}

function atomicTypeSchema(sourceType: string): import("../types.js").JsonSchema {
  const normalized = sourceType.replace(/\s+/g, "");
  if (normalized === "None" || normalized === "null") return { type: "null" };
  if (normalized.includes("bool")) return { type: "boolean" };
  if (normalized.includes("int")) return { type: "integer" };
  if (normalized.includes("float") || normalized.includes("decimal")) return { type: "number" };
  if (normalized.includes("str") || normalized.includes("Sort") || normalized.includes("Path")) return { type: "string" };
  if (normalized.includes("list") || normalized.includes("Sequence")) {
    return { type: "array", items: { type: "string" } };
  }
  if (normalized.includes("dict") || normalized.includes("Mapping")) {
    return { type: "object", additionalProperties: true };
  }
  if (normalized.includes("Any")) return {};
  return { type: "object", additionalProperties: true };
}

function simpleTypeSchema(
  sourceType: string,
  name: string,
  description: string
): import("../types.js").JsonSchema {
  const normalized = sourceType.replace(/\s+/g, "");
  const base = { description, "x-source-type": sourceType };

  if (name === "configuration" && normalized.includes("DownloadConfigHLS")) {
    return {
      type: "object",
      description: "DownloadConfigHLS options. Function callbacks, asyncio events and output-only fields are intentionally excluded from the JSON interface.",
      properties: {
        quality: {
          anyOf: [
            { type: "string", enum: ["best", "half", "worst"] },
            { type: "integer", minimum: 1 }
          ],
          description: "Required quality preset or pixel height."
        },
        path: { type: "string", default: "./", description: "Output directory or exact file path." },
        no_title: { type: "boolean", default: false },
        remux: { type: "boolean", default: false, description: "Remux TS segments to MP4; requires FFmpeg on the upstream runtime." },
        start_segment: { type: "integer", minimum: 0, default: 0 },
        segment_state_path: { type: "string" },
        segment_dir: { type: "string" },
        return_report: { type: "boolean", default: false },
        cleanup_on_stop: { type: "boolean", default: true },
        keep_segment_dir: { type: "boolean", default: false },
        ios_support: { type: "boolean", default: false }
      },
      required: ["quality"],
      additionalProperties: false,
      ...base
    };
  }

  if (normalized.includes("IteratorConfig")) {
    return {
      type: "object",
      description: "Public iterator controls. Callable error handlers and runtime-only objects are not serializable over JSON.",
      additionalProperties: true,
      ...base
    };
  }

  if (normalized.includes("|")) {
    const alternatives = normalized.split("|").map((part) => {
      const cleaned = part.replace(/^["']|["']$/g, "");
      if (cleaned === "all") return { type: "string", enum: ["all"] } as const;
      return atomicTypeSchema(cleaned);
    });
    const unique = new Map(alternatives.map((item) => [JSON.stringify(item), item]));
    return { anyOf: [...unique.values()], ...base };
  }

  return { ...atomicTypeSchema(normalized), ...base };
}

function parseSignatureParameters(signature: string): Array<{ name: string; type: string; defaultText?: string }> {
  const open = signature.indexOf("(");
  if (open < 0) return [];
  const close = signature.indexOf(")", open + 1);
  if (close < 0) return [];
  const block = signature.slice(open + 1, close);
  const parameters: Array<{ name: string; type: string; defaultText?: string }> = [];

  for (const line of block.split(/\n|,(?![^[]*\])/)) {
    const candidate = line.trim().replace(/,$/, "");
    if (!candidate) continue;
    const match = candidate.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+?)(?:\s*=\s*([\s\S]+))?$/);
    if (!match) continue;
    const parameter: { name: string; type: string; defaultText?: string } = {
      name: match[1] ?? "",
      type: (match[2] ?? "").trim()
    };
    if (match[3] !== undefined) parameter.defaultText = match[3].trim();
    parameters.push(parameter);
  }
  return parameters;
}

function operationFromCard(
  $: CheerioAPI,
  card: ReturnType<CheerioAPI>,
  anchor: string,
  sourceUrl: string
): RawOperation | undefined {
  const titleNode = card.find(".method-title").first();
  if (titleNode.length === 0) return undefined;
  const methodName = titleNode.find("code").first().text().trim();
  const displayTitle = cleanText(titleNode.clone().children("a").remove().end().text()).replace(methodName, "").trim();
  const description = cleanText(card.find(".method-desc").first().text());
  const signature = card.find(".method-signature").first().text();
  const arrow = signature.lastIndexOf("->");
  const returnType = arrow >= 0 ? cleanText(signature.slice(arrow + 2)) : "";
  const owner = anchor.split("-")[0] ?? "client";
  const sourceParams = parseSignatureParameters(signature);
  const descriptions = new Map<string, { type: string; description: string }>();

  card.find(".param-item").each((_index, element) => {
    const item = $(element);
    const name = item.find(".param-name").text().trim();
    const type = item.find(".param-type").text().trim();
    const desc = cleanText(item.find(".param-desc").text().replace(/^—\s*/, ""));
    if (name) descriptions.set(name, { type, description: desc });
  });

  const parameters: ParameterDefinition[] = sourceParams.map((parameter) => {
    const documented = descriptions.get(parameter.name);
    const sourceType = documented?.type || parameter.type;
    const descriptionText = documented?.description || ("Documented parameter of type " + sourceType + ".");
    const definition: ParameterDefinition = {
      name: parameter.name,
      description: descriptionText,
      sourceType,
      required: parameter.defaultText === undefined && !sourceType.includes("None"),
      schema: simpleTypeSchema(sourceType, parameter.name, descriptionText)
    };
    if (parameter.defaultText !== undefined) {
      definition.defaultValue = sourceDefault(parameter.defaultText);
      definition.schema = { ...definition.schema, default: definition.defaultValue, "x-source-default": parameter.defaultText };
    }
    return definition;
  });

  const context: Record<string, { name: string; description: string }> = {
    video: { name: "video_url", description: "URL of the video instance on which this method is called." },
    channel: { name: "channel_url", description: "URL of the channel profile instance on which this method is called." },
    pornstar: { name: "pornstar_url", description: "URL of the performer profile instance on which this method is called." }
  };
  const requiredContext = context[owner];
  if (requiredContext && !parameters.some((parameter) => parameter.name === requiredContext.name)) {
    parameters.unshift({
      name: requiredContext.name,
      description: requiredContext.description,
      sourceType: "str (context inferred from parent object)",
      required: true,
      schema: { type: "string", description: requiredContext.description, "x-source-type": "context" }
    });
  }

  const operation: RawOperation = {
    id: anchor,
    title: displayTitle || methodName || anchor,
    description,
    sourceUrl: sourceUrl + "#" + anchor,
    sourceAnchor: anchor,
    owner,
    sourceMethod: methodName || anchor,
    asynchronous: card.find(".tag-async").length > 0 || /\basync\b/.test(signature),
    parameters
  };
  if (returnType) operation.returnType = returnType;
  return operation;
}

export class CustomHtmlDocsExtractor {
  protected readonly sidebarSelector: string;

  constructor(sidebarSelector = "#sidebarNav") {
    this.sidebarSelector = sidebarSelector;
  }

  async extract(input: ExtractorInput): Promise<ExtractedDocumentation> {
    const $ = load(input.page.html);
    const navigation = this.collectNavigation($, input.page.url);
    const pages: DocumentPage[] = [{
      title: input.page.title,
      url: input.page.url,
      content: input.page.description,
      contentType: input.page.contentType
    }];
    const sourceDocuments: Array<{ url: string; html: string }> = [{ url: input.page.url, html: input.page.html }];

    const seenPageUrls = new Set<string>([new URL(input.page.url).toString()]);
    for (const item of navigation) {
      const cleanUrl = new URL(item.url);
      cleanUrl.hash = "";
      const normalized = cleanUrl.toString();
      if (seenPageUrls.has(normalized) || pages.length >= input.maxPages) continue;
      seenPageUrls.add(normalized);
      try {
        const fetched = await input.fetchPage(normalized);
        const pageHtml = load(fetched.html);
        const mainText = cleanText(pageHtml("main").text() || pageHtml("article").text() || pageHtml("body").text());
        pages.push({
          title: fetched.title || item.title,
          url: normalized,
          content: mainText.slice(0, 12_000),
          contentType: fetched.contentType
        });
        sourceDocuments.push({ url: normalized, html: fetched.html });
      } catch (error) {
        pages.push({
          title: item.title,
          url: normalized,
          content: "Page fetch failed: " + (error instanceof Error ? error.message : String(error)),
          contentType: "error"
        });
      }
    }

    const operations: RawOperation[] = [];
    const seen = new Set<string>();
    const extractCards = (html: string, pageUrl: string): void => {
      const dom = load(html);
      dom(".section-anchor[id]").each((_index, element) => {
        const anchorNode = dom(element);
        const id = anchorNode.attr("id");
        if (!id) return;
        const operationKey = pageUrl + "#" + id;
        if (seen.has(operationKey)) return;
        const card = anchorNode.nextAll(".method-card").first();
        const operation = operationFromCard(dom, card, id, pageUrl);
        if (!operation) return;
        seen.add(operationKey);
        operations.push(operation);
      });
    };
    for (const document of sourceDocuments) extractCards(document.html, document.url);

    const upstreamUrl = input.page.html.match(/https?:\/\/[^\s"'<>]+\/mcp\b/i)?.[0]?.replace(/[).,]+$/, "");
    const description = input.page.description || cleanText($("main").text().slice(0, 1000));
    const title = $("h1").first().text().trim() || input.page.title;
    const version = $(".sidebar-version").first().text().trim() || undefined;
    const language = /Python\s*[·|•]/i.test(input.page.html) ? "Python" : undefined;

    const result: ExtractedDocumentation = {
      title,
      description,
      language,
      kind: operations.length > 0 ? "sdk" : "unknown",
      navigation,
      pages,
      operations
    };
    if (version) result.version = version;
    if (extractedRestApi(input.page.html)) result.kind = "hybrid";
    if (upstreamUrl) {
      result.upstream = {
        protocol: "mcp",
        url: upstreamUrl,
        discoveredFrom: input.page.url
      };
    }
    return result;
  }

  protected collectNavigation($: CheerioAPI, sourceUrl: string): NavigationItem[] {
    const nav = $(this.sidebarSelector).first();
    const items: NavigationItem[] = [];
    let currentSection = "";

    const addLink = (element: Parameters<CheerioAPI>[0], section: string): void => {
      const anchor = $(element);
      const href = anchor.attr("href");
      const title = cleanText(anchor.text());
      if (!href || !title) return;
      let absolute: string;
      try {
        absolute = new URL(href, sourceUrl).toString();
      } catch {
        return;
      }
      const hash = new URL(absolute).hash.slice(1) || undefined;
      const parentNode = anchor.closest(".nav-collapsible");
      const parent = parentNode.find(".nav-link-parent").first().text().replace(/▼/g, "").trim() || undefined;
      const item: NavigationItem = {
        title,
        url: absolute,
        depth: anchor.hasClass("nav-link-sub") ? 2 : parent ? 1 : 0
      };
      if (hash) item.anchor = hash;
      if (parent && !anchor.hasClass("nav-link-parent")) item.parent = parent;
      if (section) item.section = section;
      items.push(item);
    };

    nav.children().each((_index, element) => {
      const child = $(element);
      if (child.hasClass("nav-section-title")) {
        currentSection = cleanText(child.text());
        return;
      }
      if (child.is("a")) {
        addLink(element, currentSection);
        return;
      }
      child.find("a[href]").each((_linkIndex, link) => addLink(link, currentSection));
    });

    // Some generators put navigation links under nested wrappers rather than direct children.
    if (items.length === 0) {
      nav.find("a[href]").each((_index, element) => addLink(element, currentSection));
    }
    return items;
  }
}

function extractedRestApi(html: string): boolean {
  return /openapi|swagger|application\/vnd\.oas|api-reference/i.test(html);
}