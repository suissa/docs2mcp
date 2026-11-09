import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AnalyzedPage } from "../types.js";

export interface DocsAnalyzerOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = octets;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.")
  );
}

async function assertPublicHttpUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Documentation URL must be an absolute HTTP(S) URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS documentation URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Credentials embedded in documentation URLs are not allowed.");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private and local documentation hosts are blocked to prevent SSRF.");
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIPv4(host)) {
    throw new Error("Private IPv4 documentation hosts are blocked to prevent SSRF.");
  }
  if (ipVersion === 6 && isPrivateIPv6(host)) {
    throw new Error("Private IPv6 documentation hosts are blocked to prevent SSRF.");
  }

  if (ipVersion === 0) {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) =>
      isIP(record.address) === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address)
    )) {
      throw new Error("Documentation host resolves to a private or non-public address.");
    }
  }
  return url;
}

export class DocsAnalyzer {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(options: DocsAnalyzerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxBytes = options.maxBytes ?? 5_000_000;
    this.maxRedirects = options.maxRedirects ?? 5;
  }

  async analyze(url: string): Promise<AnalyzedPage> {
    return this.fetchPage(url);
  }

  async fetchPage(value: string): Promise<AnalyzedPage> {
    let url = await assertPublicHttpUrl(value);
    let response: Response | undefined;

    for (let redirect = 0; redirect <= this.maxRedirects; redirect += 1) {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "user-agent": "docs2mcp/0.1.0 (+https://github.com/suissa/docs2mcp)",
          accept: "text/html,application/xhtml+xml,text/markdown;q=0.9,*/*;q=0.5"
        }
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("Documentation server returned a redirect without Location.");
      url = await assertPublicHttpUrl(new URL(location, url).toString());
    }

    if (!response) throw new Error("No response received from the documentation server.");
    if (response.status < 200 || response.status >= 300) {
      throw new Error("Documentation GET failed with HTTP " + response.status + " at " + url.toString());
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > this.maxBytes) {
      throw new Error("Documentation page exceeds the configured " + this.maxBytes + " byte limit.");
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > this.maxBytes) {
      throw new Error("Documentation page exceeds the configured " + this.maxBytes + " byte limit.");
    }

    const contentType = response.headers.get("content-type") ?? "text/html";
    if (!/html|markdown|text\/plain/i.test(contentType)) {
      throw new Error("Expected HTML or Markdown documentation, received " + contentType + ".");
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    return {
      url: url.toString(),
      html,
      title: (titleMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim() || url.hostname,
      description: descriptionMatch?.[1]?.trim() ?? "",
      contentType
    };
  }
}