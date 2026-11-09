# docs2mcp

Turn an online documentation site into a typed MCP server and a local REST/WebSocket API.

docs2mcp reads the documentation's navigation, extracts operation contracts and examples, normalizes everything into a versioned universal JSON model, then generates TypeScript strict runtime configuration and server artifacts.

## Current first vertical: XVideos API documentation

- Documentation: https://docs.echteralsfake.me/xvideos/
- Sidebar: #sidebarNav
- Documentation system: custom-html (hand-authored HTML; no Mintlify, Docsify, Hugo, MkDocs or Docusaurus generator signature was found).
- Package described by the page: asynchronous Python SDK unofficial-api-for-xvideos v2.5.3.
- Discovered upstream transport: MCP at https://mcp.echteralsfake.me/mcp.

The source documentation describes Python SDK methods, not public HTTP REST routes. docs2mcp therefore does not fabricate calls to undocumented origin HTTP endpoints. It exposes a local REST/WS façade and dispatches each operation to the real tools discovered from the upstream MCP server. The generated proxy maps discovered upstream tool names using exact aliases first, then a token-overlap heuristic.

The four priority contracts are mapped as follows:

| Documentation anchor | MCP tool name | Local REST route |
| --- | --- | --- |
| #client-search | xvideos_search_videos | GET /api/v1/xvideos/search |
| #video-download | xvideos_download_video | POST /api/v1/xvideos/videos/download |
| #channel-videos | xvideos_get_channel_videos | GET /api/v1/xvideos/channels/videos |
| #pornstar-videos | xvideos_get_pornstar_videos | GET /api/v1/xvideos/pornstars/videos |

Context parameters (video_url, channel_url, pornstar_url) represent Python instance receivers. Download configuration is converted to a JSON object schema; callback functions, asyncio.Event, and output-only Python fields are not exposed as JSON inputs.

## Install

Node.js 22 or newer is required.

After the package is published:

~~~bash
npm install -g docs2mcp
docs2mcp --help
~~~

To use this implementation directly from the GitHub branch before an npm release:

~~~bash
npm install -g github:suissa/docs2mcp#feat/xvideos-docs-to-mcp
~~~

## Generate from a JSON configuration

~~~bash
docs2mcp generate --config examples/xvideos.config.json
~~~

Or pass the URL directly:

~~~bash
docs2mcp generate https://docs.echteralsfake.me/xvideos/ \
  --system custom-html \
  --output ./generated/xvideos
~~~

The config file is Everything-as-Code: source URL, documentation system override, output directory, enabled channels, upstream MCP endpoint, host/port, inspection, and automatic launch behavior.

~~~json
{
  "$schema": "./schema/docs2mcp.config.schema.json",
  "url": "https://docs.echteralsfake.me/xvideos/",
  "system": "custom-html",
  "outputDir": "./generated/xvideos",
  "channels": {
    "rest": true,
    "ws": true,
    "stdio": true,
    "mcpHttp": true
  },
  "upstream": {
    "url": "https://mcp.echteralsfake.me/mcp"
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8787
  },
  "inspect": true,
  "runServer": false
}
~~~

Omit system to let DocsClassifier detect the HTML framework. Use --channels rest,ws,stdio,mcphttp to override the channels from the CLI.

## Generated outputs

The generator writes:

- docs2mcp.universal.json — normalized documentation and operation model.
- docs2mcp.config.json — runtime configuration.
- tools.schema.json — compact tool/REST contracts.
- server.ts — generated TypeScript strict entry point.
- package.json and tsconfig.json — runnable TypeScript project metadata.

Install the runtime dependency, build, and run:

~~~bash
cd generated/xvideos
npm install
npm run build
npm start
~~~

When REST and WebSocket are enabled, the default local server listens on 127.0.0.1:8787.

| Channel | Endpoint |
| --- | --- |
| REST catalog | GET /api/v1/tools |
| Health | GET /health |
| OpenAPI 3.1 | GET /openapi.json |
| WebSocket | ws://127.0.0.1:8787/ws |
| MCP Streamable HTTP | http://127.0.0.1:8787/mcp |
| MCP stdio | enabled through the generated process |

Example requests:

~~~bash
# Search. pages accepts a number or "all".
curl -G http://127.0.0.1:8787/api/v1/xvideos/search \
  --data-urlencode "query=documented search" \
  --data-urlencode "pages=2"

# List videos on a channel profile (pages=0 means all pages in the source SDK).
curl -G http://127.0.0.1:8787/api/v1/xvideos/channels/videos \
  --data-urlencode "channel_url=https://www.xvideos.com/channels/example" \
  --data-urlencode "pages=0"

# List videos on a performer profile.
curl -G http://127.0.0.1:8787/api/v1/xvideos/pornstars/videos \
  --data-urlencode "pornstar_url=https://www.xvideos.com/pornstars/example" \
  --data-urlencode "pages=0"

# Download uses the source SDK DownloadConfigHLS object.
curl -X POST http://127.0.0.1:8787/api/v1/xvideos/videos/download \
  -H 'content-type: application/json' \
  -d '{"video_url":"https://www.xvideos.com/video.example","configuration":{"quality":"best","path":"./downloads"}}'
~~~

The source docs note that TS-to-MP4 remuxing requires FFmpeg. The download action writes files on the upstream MCP server's runtime, not the docs2mcp REST process.

## Pipeline

~~~text
MCPForger(config.json)
  -> DocsAnalyzer (GET + bounded redirects + SSRF guard)
  -> DocsClassifier (explicit override or HTML fingerprints)
  -> DocsForger
      -> {System}DocsExtractor
          -> sidebar/navigation extraction
          -> page and operation extraction
          -> parameter/default/return extraction
  -> {System}DocsShaper
      -> UniversalDocsShaper
          -> docs2mcp universal JSON schema v1.0.0
          -> ToolNameHeuristic
  -> MCPSchemaForger
      -> universal model JSON
      -> runtime config JSON
      -> generated TypeScript strict project
  -> MCPServerInspector
      -> REST integration checks
      -> WebSocket tools/list + tools/call
      -> MCP Streamable HTTP tools/list + tools/call
      -> stdio process tools/list + tools/call
  -> Docs2MCPFinisher
      -> logs operations, channels, generated files and checks
      -> optional server startup
~~~

## Supported documentation classifiers

The initial adapters recognize Mintlify, Docsify, Hugo, MkDocs, Docusaurus and custom HTML. Unknown or unsupported HTML is retained as unknown and still receives the generic navigation extractor. Platform signatures are evidence-based; the classifier never labels a site with a framework merely because it has a sidebar.

The AbacatePay reference supplied for implementation is Mintlify-based and provides a second fixture target for the next extractor iteration. The current MVP's full operation extraction is focused on the custom-html XVideos documentation.

## Universal schema

The cross-system contract lives in schema/docs2mcp.universal.schema.json. Every system extractor must shape its data into this model instead of emitting provider-specific MCP code. Operation fields include:

- source URL and anchor, display title, source method, owner and return type;
- typed parameters, defaults, required flags and JSON Schema;
- stable MCP tool name and matching aliases;
- generated REST method/path and safety annotations.

## Tool-name heuristic

Tool names are stable, lowercase, and domain-prefixed. Method names are not used in isolation when they are ambiguous. For example, videos() becomes xvideos_get_channel_videos or xvideos_get_pornstar_videos depending on the owning object. search() becomes xvideos_search_videos; download() becomes xvideos_download_video. The universal operation ID and source anchor remain available as aliases for upstream mapping.

## Security notes

- Documentation fetches allow only HTTP(S), reject embedded URL credentials, block private/local IP ranges, resolve DNS before connecting, limit redirects, and cap page size.
- Local generated servers bind to 127.0.0.1 by default. The MCP Fastify adapter applies localhost Host/Origin validation.
- Generated operation inputs are validated against their extracted JSON Schemas before tool execution.
- Upstream calls go through the MCP endpoint advertised by the source documentation. This first target uses its documented unauthenticated MCP endpoint; credentials and additional headers can be added to the config for other providers.
- docs2mcp does not bypass access controls or claim to grant permission to use third-party sites. Follow the target service's terms, rate limits, copyright rules, and local law.

## Development

~~~bash
npm install
npm run typecheck
npm run build
npm test
~~~

CI runs typecheck, build, and integration tests for every pull request. The channel inspector uses an echo executor, so local protocol checks do not download media or depend on upstream availability.

## License

MIT.
