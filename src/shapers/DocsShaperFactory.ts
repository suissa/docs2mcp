import type {
  DocumentationClassification,
  ExtractedDocumentation,
  UniversalDocumentation
} from "../types.js";
import {
  CustomHtmlDocsShaper,
  DocusaurusDocsShaper,
  DocsifyDocsShaper,
  HugoDocsShaper,
  MintlifyDocsShaper,
  MkDocsDocsShaper,
  UniversalDocsShaper
} from "./UniversalDocsShaper.js";

export class DocsShaperFactory {
  shape(
    extracted: ExtractedDocumentation,
    sourceUrl: string,
    classification: DocumentationClassification,
    channels: Partial<UniversalDocumentation["channels"]> = {}
  ): UniversalDocumentation {
    const shaper = (() => {
      switch (classification.system) {
        case "mintlify": return new MintlifyDocsShaper();
        case "docsify": return new DocsifyDocsShaper();
        case "hugo": return new HugoDocsShaper();
        case "mkdocs": return new MkDocsDocsShaper();
        case "docusaurus": return new DocusaurusDocsShaper();
        case "custom-html": return new CustomHtmlDocsShaper();
        default: return new UniversalDocsShaper();
      }
    })();
    return shaper.shape(extracted, sourceUrl, classification, channels);
  }
}