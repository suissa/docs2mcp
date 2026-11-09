import type { AnalyzedPage, DocumentationSystem, ExtractedDocumentation } from "../types.js";
import { CustomHtmlDocsExtractor } from "../extractors/CustomHtmlDocsExtractor.js";
import {
  DocusaurusDocsExtractor,
  DocsifyDocsExtractor,
  HugoDocsExtractor,
  MintlifyDocsExtractor,
  MkDocsDocsExtractor,
  UnknownDocsExtractor
} from "../extractors/SystemDocsExtractors.js";

export class DocsForger {
  async forge(
    page: AnalyzedPage,
    system: DocumentationSystem,
    fetchPage: (url: string) => Promise<AnalyzedPage>,
    maxPages = 100
  ): Promise<ExtractedDocumentation> {
    const extractor = this.createExtractor(system);
    return extractor.extract({ page, fetchPage, maxPages });
  }

  private createExtractor(system: DocumentationSystem): CustomHtmlDocsExtractor {
    switch (system) {
      case "mintlify": return new MintlifyDocsExtractor();
      case "docsify": return new DocsifyDocsExtractor();
      case "hugo": return new HugoDocsExtractor();
      case "mkdocs": return new MkDocsDocsExtractor();
      case "docusaurus": return new DocusaurusDocsExtractor();
      case "custom-html": return new CustomHtmlDocsExtractor("#sidebarNav");
      default: return new UnknownDocsExtractor();
    }
  }
}