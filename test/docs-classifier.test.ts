import { describe, expect, it } from "vitest";
import { DocsClassifier } from "../src/core/DocsClassifier.js";

describe("DocsClassifier", () => {
  const classifier = new DocsClassifier();

  it("detects custom HTML documentation through #sidebarNav", () => {
    const result = classifier.classify('<html><nav id="sidebarNav"></nav></html>');
    expect(result.system).toBe("custom-html");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it.each([
    ["mintlify", '<script src="https://mintlify.com/widget.js"></script>'],
    ["docsify", '<script>window.$docsify = {};</script>'],
    ["hugo", '<meta name="generator" content="Hugo 0.120.0">'],
    ["mkdocs", '<meta name="generator" content="mkdocs">'],
    ["docusaurus", '<div id="__docusaurus"></div>']
  ] as const)("detects %s documentation", (system, html) => {
    expect(classifier.classify(html).system).toBe(system);
  });

  it("honors an explicitly configured system", () => {
    const result = classifier.classify("<html></html>", "docsify");
    expect(result.system).toBe("docsify");
    expect(result.detectedBy).toBe("user-configuration");
  });
});