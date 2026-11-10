import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpApiExecutor } from "../src/runtime/HttpApiExecutor.js";
import type { OperationDefinition, UniversalDocumentation } from "../src/types.js";

function model(securitySchemes: Record<string, unknown> = {}): UniversalDocumentation {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-11-10T00:00:00.000Z",
    source: {
      url: "https://docs.example.test",
      title: "Example API",
      description: "",
      system: "mintlify",
      classification: {
        system: "mintlify",
        confidence: 0.99,
        detectedBy: "fixture",
        signals: ["mintlify"]
      },
      kind: "http-api",
      api: {
        baseUrl: "https://api.example.test/v1",
        specificationUrls: [],
        securitySchemes
      }
    },
    navigation: [],
    pages: [],
    operations: [],
    channels: { rest: true, ws: true, stdio: true, mcpHttp: true }
  };
}

function operation(overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return {
    id: "getWidget",
    title: "Get widget",
    description: "",
    sourceUrl: "https://docs.example.test/widgets",
    sourceAnchor: "get-widget",
    sourceMethod: "getWidget",
    asynchronous: false,
    parameters: [
      {
        name: "widgetId",
        description: "",
        sourceType: "string",
        required: true,
        schema: { type: "string" },
        location: "path"
      },
      {
        name: "expand",
        description: "",
        sourceType: "string",
        required: false,
        schema: { type: "string" },
        location: "query"
      },
      {
        name: "tag",
        description: "",
        sourceType: "string[]",
        required: false,
        schema: { type: "array", items: { type: "string" } },
        location: "query"
      },
      {
        name: "x-trace-id",
        description: "",
        sourceType: "string",
        required: false,
        schema: { type: "string" },
        location: "header"
      }
    ],
    inputSchema: { type: "object" },
    toolName: "example_get_widget",
    upstreamAliases: ["getWidget"],
    http: { method: "GET", path: "/api/v1/widgets/{widgetId}" },
    sourceHttp: {
      method: "GET",
      path: "/widgets/{widgetId}",
      security: []
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    },
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("HttpApiExecutor", () => {
  it("substitutes path parameters, encodes query arrays and forwards explicit headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "a/b", ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const executor = new HttpApiExecutor(model(), { timeoutMs: 5000 });
    const result = await executor.execute(operation(), {
      widgetId: "a/b",
      expand: "owner",
      tag: ["one", "two words"],
      "x-trace-id": "trace-123"
    });

    expect(result).toEqual({ id: "a/b", ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.toString()).toBe(
      "https://api.example.test/v1/widgets/a%2Fb?expand=owner&tag=one&tag=two+words"
    );
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("x-trace-id")).toBe("trace-123");
    expect(new Headers(init?.headers).get("accept")).toContain("application/json");
  });

  it("uses the named environment variable for Bearer authentication", async () => {
    vi.stubEnv("ABACATEPAY_TOKEN", "secret-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const apiModel = model({
      "api-key": { type: "http", scheme: "bearer" }
    });
    const apiOperation = operation({
      sourceHttp: {
        method: "POST",
        path: "/checkouts",
        security: ["api-key"],
        requestBodyRequired: true
      },
      parameters: [{
        name: "body",
        description: "",
        sourceType: "object",
        required: true,
        schema: { type: "object" },
        location: "body"
      }]
    });
    const executor = new HttpApiExecutor(apiModel, {
      authEnv: { "api-key": "ABACATEPAY_TOKEN" }
    });

    await executor.execute(apiOperation, { body: { amount: 1000 } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-token");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ amount: 1000 }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("returns null for an empty 204 response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })));
    const result = await new HttpApiExecutor(model()).execute(operation(), { widgetId: "42" });
    expect(result).toBeNull();
  });

  it("surfaces source API status and response details for non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid token" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    ));

    await expect(
      new HttpApiExecutor(model()).execute(operation(), { widgetId: "42" })
    ).rejects.toThrow('Source API HTTP 401: {"error":"invalid token"}');
  });

  it("fails before making a request when a path parameter is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpApiExecutor(model()).execute(operation(), {})
    ).rejects.toThrow("Missing path parameter: widgetId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an operation without a source HTTP binding", async () => {
    const sdkOperation = operation({ sourceHttp: undefined });
    await expect(
      new HttpApiExecutor(model()).execute(sdkOperation, { widgetId: "42" })
    ).rejects.toThrow("Operation does not contain an HTTP source binding.");
  });
});
