import type { DocumentationClassification, DocumentationSystem } from "../types.js";

const RULES: Array<{
  system: DocumentationSystem;
  confidence: number;
  detectedBy: string;
  patterns: RegExp[];
}> = [
  {
    system: "mintlify",
    confidence: 0.99,
    detectedBy: "mintlify-html-signatures",
    patterns: [/mintlify/i, /mintlify\.com/i, /mintlify\.json/i, /mintlify-sidebar/i]
  },
  {
    system: "docusaurus",
    confidence: 0.99,
    detectedBy: "docusaurus-html-signatures",
    patterns: [/__docusaurus/i, /docusaurus/i, /theme-doc-markdown/i, /docSidebar/i]
  },
  {
    system: "mkdocs",
    confidence: 0.99,
    detectedBy: "mkdocs-html-signatures",
    patterns: [/<meta[^>]+name=["']generator["'][^>]+mkdocs/i, /md-content/i, /md-nav__link/i, /mkdocs-material/i]
  },
  {
    system: "docsify",
    confidence: 0.98,
    detectedBy: "docsify-html-signatures",
    patterns: [/window\.\$docsify/i, /docsify/i, /sidebar-nav/i, /_sidebar\.md/i]
  },
  {
    system: "hugo",
    confidence: 0.98,
    detectedBy: "hugo-html-signatures",
    patterns: [/<meta[^>]+generator[^>]+hugo/i, /hugo-theme/i, /hugo\.js/i]
  }
];

export class DocsClassifier {
  classify(html: string, forcedSystem?: DocumentationSystem): DocumentationClassification {
    if (forcedSystem) {
      return {
        system: forcedSystem,
        confidence: 1,
        detectedBy: "user-configuration",
        signals: ["system supplied in MCPForger JSON configuration"]
      };
    }

    const sample = html.slice(0, 500_000);
    for (const rule of RULES) {
      const signals = rule.patterns
        .filter((pattern) => pattern.test(sample))
        .map((pattern) => pattern.source);
      if (signals.length > 0) {
        return {
          system: rule.system,
          confidence: Math.min(0.99, 0.9 + signals.length * 0.02),
          detectedBy: rule.detectedBy,
          signals
        };
      }
    }

    if (/<nav[^>]+id=["']sidebarNav["']/i.test(sample) || /id=["']sidebarNav["']/i.test(sample)) {
      return {
        system: "custom-html",
        confidence: 0.97,
        detectedBy: "custom-sidebar-html-signature",
        signals: ["#sidebarNav", "no known documentation-generator marker"]
      };
    }

    if (/<nav[\s>]/i.test(sample) && /<main[\s>]/i.test(sample)) {
      return {
        system: "custom-html",
        confidence: 0.68,
        detectedBy: "semantic-html-fallback",
        signals: ["semantic navigation and main content elements"]
      };
    }

    return {
      system: "unknown",
      confidence: 0.2,
      detectedBy: "no-recognized-signature",
      signals: []
    };
  }
}