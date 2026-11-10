import { describe, expect, it } from "vitest";
import { OpenApiDocsExtractor } from "../src/extractors/OpenApiDocsExtractor.js";

describe("Mintlify OpenAPI extraction", () => {
  it("extracts embedded Mintlify operation, nested request schema, response and API server", async () => {
    const reference = {
      operation: { summary: "Criar um Checkout", description: "Cria um Checkout para o cliente realizar o pagamento.", method: "post", path: "/checkouts/create", baseUrlOptions: ["https://api.abacatepay.com/v2"], requestBody: "body-1", responses: { "200": "response-1" }, security: ["api-key"] },
      dependencies: {
        parameters: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", minItems: 1, items: { type: "object", required: ["id", "quantity"], properties: { id: { type: "string", description: "Public product id." }, quantity: { type: "integer", minimum: 1 } }, additionalProperties: false } }, methods: { type: "array", default: ["PIX", "CARD"], items: { type: "string", enum: ["PIX", "CARD", "BOLETO"] } } } } } } },
        responses: { "response-1": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, url: { type: "string", format: "uri" } } } } } },
        processedSecurityOptions: []
      }
    };
    const html = "<html><body><script type=\"application/json\">" + JSON.stringify({ openApiReferenceData: reference }) + "</script></body></html>";
    const page = { url: "https://docs.abacatepay.com/pages/payment/create", html, title: "Criar um Checkout", description: "Create checkout", contentType: "text/html" };
    const extracted = await new OpenApiDocsExtractor().extract({
      page,
      extracted: { title: "Criar um Checkout", description: "Create checkout", kind: "unknown", navigation: [], pages: [], operations: [], sourceDocuments: [{ url: page.url, html }] },
      fetchPage: async (url) => ({ url, html: "", title: "", description: "", contentType: "application/json" })
    });
    expect(extracted.operations).toHaveLength(1);
    expect(extracted.kind).toBe("http-api");
    const operation = extracted.operations[0]!;
    expect(operation.sourceHttp?.method).toBe("POST");
    expect(operation.sourceHttp?.path).toBe("/checkouts/create");
    expect(operation.sourceHttp?.baseUrl).toBe("https://api.abacatepay.com/v2");
    expect(operation.parameters.find((parameter) => parameter.name === "body")?.schema.properties?.items?.items?.required).toEqual(["id", "quantity"]);
    expect(operation.outputSchema?.properties?.url?.format).toBe("uri");
    expect(extracted.api?.baseUrl).toBe("https://api.abacatepay.com/v2");
  });

  it("imports an OpenAPI JSON document with path parameters, auth schemes and refs", async () => {
    const spec = { openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }], components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, schemas: { Thing: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } }, paths: { "/things/{thingId}": { parameters: [{ name: "thingId", in: "path", required: true, schema: { type: "string" } }], get: { operationId: "getThing", security: [{ bearer: [] }], responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Thing" } } } } } } } };
    const root = "https://docs.example.test/";
    const html = "<html><body><a href=\"/openapi.json\">OpenAPI</a></body></html>";
    const extracted = await new OpenApiDocsExtractor().extract({
      page: { url: root, html, title: "Example", description: "", contentType: "text/html" },
      extracted: { title: "Example", description: "", kind: "unknown", navigation: [], pages: [], operations: [], sourceDocuments: [{ url: root, html }] },
      fetchPage: async (url) => ({ url, html: JSON.stringify(spec), title: "OpenAPI", description: "", contentType: "application/json" })
    });
    expect(extracted.operations).toHaveLength(1);
    const operation = extracted.operations[0]!;
    expect(operation.sourceHttp?.path).toBe("/things/{thingId}");
    expect(operation.parameters[0]?.location).toBe("path");
    expect(operation.sourceHttp?.security).toEqual(["bearer"]);
    expect(operation.outputSchema?.required).toEqual(["name"]);
    expect(extracted.api?.securitySchemes?.bearer).toEqual({ type: "http", scheme: "bearer" });
  });
});
