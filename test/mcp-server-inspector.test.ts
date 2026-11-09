import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocsClassifier } from "../src/core/DocsClassifier.js";
import { DocsForger } from "../src/core/DocsForger.js";
import { UniversalDocsShaper } from "../src/shapers/UniversalDocsShaper.js";
import { MCPServerInspector } from "../src/core/MCPServerInspector.js";

describe("MCPServerInspector", () => {
  it("tests REST, WebSocket, MCP HTTP and stdio channels end-to-end", async () => {
    const html = await readFile(fileURLToPath(new URL("./fixtures/xvideos.html", import.meta.url)), "utf8");
    const page = {
      url: "https://docs.echteralsfake.me/xvideos/",
      html,
      title: "XVideos API — Documentation",
      description: "Asynchronous API wrapper documentation.",
      contentType: "text/html"
    };
    const classification = new DocsClassifier().classify(html);
    const extracted = await new DocsForger().forge(page, classification.system, async (url) => ({
      url, html: "", title: "", description: "", contentType: "text/html"
    }), 100);
    const model = new UniversalDocsShaper().shape(extracted, page.url, classification, {
      rest: true, ws: true, stdio: true, mcpHttp: true
    });

    const results = await new MCPServerInspector().inspect(model);
    expect(results.length).toBeGreaterThanOrEqual(9);
    expect(results.every((result) => result.passed), results.filter((result) => !result.passed).map((result) => result.details).join("\n")).toBe(true);
    expect(results.some((result) => result.channel === "rest")).toBe(true);
    expect(results.some((result) => result.channel === "ws")).toBe(true);
    expect(results.some((result) => result.channel === "mcp-http")).toBe(true);
    expect(results.some((result) => result.channel === "stdio")).toBe(true);
  });
});