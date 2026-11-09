import { CustomHtmlDocsExtractor } from "./CustomHtmlDocsExtractor.js";

export class MintlifyDocsExtractor extends CustomHtmlDocsExtractor {
  constructor() { super("nav[aria-label*=Navigation], [data-sidebar], aside nav, nav"); }
}

export class DocsifyDocsExtractor extends CustomHtmlDocsExtractor {
  constructor() { super("#sidebar-nav, .sidebar-nav, #sidebar, aside nav"); }
}

export class HugoDocsExtractor extends CustomHtmlDocsExtractor {
  constructor() { super("aside nav, .sidebar nav, .sidebar, nav"); }
}

export class MkDocsDocsExtractor extends CustomHtmlDocsExtractor {
  constructor() { super(".md-sidebar, .md-nav, nav[aria-label*=Navigation], nav"); }
}

export class DocusaurusDocsExtractor extends CustomHtmlDocsExtractor {
  constructor() { super(".theme-doc-sidebar-container, nav.menu, aside nav, nav"); }
}

export class UnknownDocsExtractor extends CustomHtmlDocsExtractor {
  constructor() { super("nav, aside, [role=navigation]"); }
}