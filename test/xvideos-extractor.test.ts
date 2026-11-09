import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocsClassifier } from "../src/core/DocsClassifier.js";
import { DocsForger } from "../src/core/DocsForger.js";
import { UniversalDocsShaper } from "../src/shapers/UniversalDocsShaper.js";

const fixtureUrl = new URL("./fixtures/xvideos.html", import.meta.url);

describe("XVideos custom HTML extractor", () => {
  it("always reads the sidebar and extracts the four priority methods", async () => {
    const html = await readFile(fileURLToPath(fixtureUrl), "utf8");
    const page = {
      url: "https://docs.echteralsfake.me/xvideos/",
      html,
      title: "XVideos API — Documentation",
      description: "Asynchronous API wrapper documentation.",
      contentType: "text/html"
    };
    const classification = new DocsClassifier().classify(html);
    const extracted = await new DocsForger().forge(page, classification.system, async (url) => ({
      url,
      html: "",
      title: "unused",
      description: "",
      contentType: "text/html"
    }), 100);

    expect(classification.system).toBe("custom-html");
    expect(extracted.navigation.map((item) => item.anchor)).toEqual(expect.arrayContaining([
      "client-search", "video-download", "channel-videos", "pornstar-videos"
    ]));
    expect(extracted.operations.map((operation) => operation.sourceAnchor)).toEqual(expect.arrayContaining([
      "client-search", "video-download", "channel-videos", "pornstar-videos"
    ]));
    expect(extracted.operations).toHaveLength(4);
    expect(extracted.version).toBe("v2.5.3");
    expect(extracted.kind).toBe("sdk");
  });

  it("shapes stable and descriptive tools with JSON input contracts", async () => {
    const html = await readFile(fileURLToPath(fixtureUrl), "utf8");
    const page = {
      url: "https://docs.echteralsfake.me/xvideos/",
      html,
      title: "XVideos API — Documentation",
      description: "Asynchronous API wrapper documentation.",
      contentType: "text/html"
    };
    const classification = new DocsClassifier().classify(html);
    const extracted = await new DocsForger().forge(page, classification.system, async (url) => ({
      url, html: "", title: "unused", description: "", contentType: "text/html"
    }), 100);
    const model = new UniversalDocsShaper().shape(extracted, page.url, classification);
    const byAnchor = new Map(model.operations.map((operation) => [operation.sourceAnchor, operation]));

    expect(byAnchor.get("client-search")?.toolName).toBe("xvideos_search_videos");
    expect(byAnchor.get("video-download")?.toolName).toBe("xvideos_download_video");
    expect(byAnchor.get("channel-videos")?.toolName).toBe("xvideos_get_channel_videos");
    expect(byAnchor.get("pornstar-videos")?.toolName).toBe("xvideos_get_pornstar_videos");

    const search = byAnchor.get("client-search");
    expect(search?.inputSchema.required).toContain("query");
    expect(search?.inputSchema.properties?.pages?.anyOf).toBeDefined();

    const download = byAnchor.get("video-download");
    expect(download?.inputSchema.required).toEqual(expect.arrayContaining(["video_url", "configuration"]));
    expect(download?.inputSchema.properties?.configuration?.properties?.quality?.required).toBeUndefined();
    expect(download?.inputSchema.properties?.configuration?.properties?.quality?.anyOf).toHaveLength(2);

    expect(byAnchor.get("channel-videos")?.inputSchema.required).toContain("channel_url");
    expect(byAnchor.get("pornstar-videos")?.inputSchema.required).toContain("pornstar_url");
  });

  it("records the source upstream MCP endpoint without inventing origin REST routes", async () => {
    const html = await readFile(fileURLToPath(fixtureUrl), "utf8");
    const classification = new DocsClassifier().classify(html);
    const page = {
      url: "https://docs.echteralsfake.me/xvideos/",
      html,
      title: "XVideos API — Documentation",
      description: "",
      contentType: "text/html"
    };
    const extracted = await new DocsForger().forge(page, classification.system, async (url) => ({
      url, html: "", title: "", description: "", contentType: "text/html"
    }), 100);
    expect(extracted.upstream?.url).toBe("https://mcp.echteralsfake.me/mcp");
    expect(extracted.kind).toBe("sdk");
  });
});