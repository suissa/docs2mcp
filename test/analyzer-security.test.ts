import { describe, expect, it } from "vitest";
import { DocsAnalyzer } from "../src/core/DocsAnalyzer.js";

describe("DocsAnalyzer security", () => {
  it.each(["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/"])(
    "rejects private and metadata service targets: %s",
    async (url) => {
      await expect(new DocsAnalyzer().analyze(url)).rejects.toThrow();
    }
  );

  it("rejects non-HTTP schemes before a request is sent", async () => {
    await expect(new DocsAnalyzer().analyze("file:///etc/passwd")).rejects.toThrow(/HTTP/);
  });
});