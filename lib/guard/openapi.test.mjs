// Run from repo root: node --test lib/guard/openapi.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

async function loadOpenApi() {
  const source = await readFile(new URL("../../openapi/ryntra-guard-v1.yaml", import.meta.url), "utf8");
  const document = yaml.load(source);
  assert.equal(typeof document, "object");
  assert.notEqual(document, null);
  return { document, source };
}

test("OpenAPI is valid YAML and every local reference resolves", async () => {
  const { document } = await loadOpenApi();

  function resolve(ref) {
    const parts = ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    return parts.reduce((value, part) => value?.[part], document);
  }

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
      assert.notEqual(resolve(value.$ref), undefined, `Unresolved OpenAPI reference: ${value.$ref}`);
    }
    Object.values(value).forEach(visit);
  }

  visit(document);
});

test("OpenAPI declares the exact Guard v1 surface and fail-closed protocol fields", async () => {
  const { document, source } = await loadOpenApi();
  const expectedOperations = {
    "/v1/intents": ["get", "post"],
    "/v1/intents/{intentId}": ["get"],
    "/v1/intents/{intentId}/preflight": ["post"],
    "/v1/evaluations/{evaluationId}": ["get"],
    "/v1/intents/{intentId}/authorize": ["post"],
    "/v1/intents/{intentId}/executions": ["post"],
    "/v1/intents/{intentId}/status": ["get"],
    "/v1/intents/{intentId}/receipt": ["get"],
    "/v1/capabilities": ["get"],
    "/health": ["get"],
  };
  assert.deepEqual(Object.keys(document.paths), Object.keys(expectedOperations));
  for (const [path, methods] of Object.entries(expectedOperations)) {
    assert.deepEqual(Object.keys(document.paths[path]), methods);
  }
  assert.equal(
    document.paths["/v1/intents"].get.parameters[0].$ref,
    "#/components/parameters/ListLimit",
  );
  assert.deepEqual(document.components.parameters.ListLimit.schema, {
    type: "integer",
    minimum: 1,
    maximum: 200,
    default: 50,
  });
  assert.match(source, /type: http\s+scheme: bearer/);
  assert.match(source, /name: Idempotency-Key/);
  assert.match(source, /name: X-Correlation-Id/);
  assert.match(source, /FINGERPRINT_MISMATCH/);
  assert.match(source, /IDEMPOTENCY_CONFLICT/);
  assert.match(source, /amount:\s+type: string/);
  assert.doesNotMatch(source, /amount:\s+type: number/);
  assert.match(source, /leverage: \{ type: \[string, 'null'\]/);

  const receiptPath = source.slice(
    source.indexOf("/v1/intents/{intentId}/receipt:"),
    source.indexOf("/v1/capabilities:"),
  );
  assert.match(receiptPath, /ReceiptResponse/);
  assert.doesNotMatch(receiptPath, /StatusResponse/);
  const healthPath = source.slice(source.indexOf("/health:"), source.indexOf("components:"));
  assert.match(healthPath, /HealthResponse/);
  assert.doesNotMatch(healthPath, /DataResponse/);
  assert.doesNotMatch(healthPath, /ReceiptResponse/);

  const evidenceSchema = source.slice(source.indexOf("    EvidenceItem:"), source.indexOf("    GuardEvaluation:"));
  for (const field of ["confidence", "chainRef", "blockRef", "transactionRef"]) {
    assert.match(evidenceSchema, new RegExp(`- ${field}`));
  }

  const evaluationSchema = source.slice(
    source.indexOf("    GuardEvaluation:"),
    source.indexOf("    GuardStatus:"),
  );
  assert.match(evaluationSchema, /- authorizationStatus/);
  assert.match(evaluationSchema, /authorizationStatus:/);
  assert.match(evaluationSchema, /- policyResult/);
  assert.match(evaluationSchema, /policyResult:\s*\{ \$ref: '#\/components\/schemas\/PolicyResult' \}/);

  const policyResultSchema = source.slice(
    source.indexOf("    PolicyResult:"),
    source.indexOf("    GuardEvaluation:"),
  );
  for (const field of ["schemaVersion", "policyRef", "policyVersion", "policyDigest", "decision", "status", "evaluatedAt"]) {
    assert.match(policyResultSchema, new RegExp(`- ${field}`));
  }

  const decisionReceipt = source.slice(
    source.indexOf("    DecisionSettlementReceipt:"),
    source.indexOf("    ExecutionFingerprint:"),
  );
  assert.match(decisionReceipt, /DecisionSettlementReceipt:\s+[\s\S]{0,100}additionalProperties: false/);
  for (const field of [
    "schemaVersion", "id", "tenantId", "authorizationStatus", "intent", "evidence", "policy", "authorization",
    "execution", "reconciliation", "settlement", "createdAt", "finalizedAt", "limitations",
    "integrity",
  ]) {
    assert.match(decisionReceipt, new RegExp(`- ${field}`));
  }
  for (const component of ["ReceiptIntent", "ReceiptEvidence", "ReceiptPolicy", "ReceiptAuthorization", "ReceiptExecution", "ReceiptReconciliation", "ReceiptSettlement", "ReceiptIntegrity"]) {
    assert.match(decisionReceipt, new RegExp(`#/components/schemas/${component}`));
  }
  const receiptSchema = document.components.schemas.DecisionSettlementReceipt;
  assert.deepEqual(receiptSchema.properties.schemaVersion.enum, ["1.0.0", "1.1.0"]);
  assert.deepEqual(
    receiptSchema.allOf[0].then.properties.authorization.allOf[1].required,
    ["expiresAt", "executionFingerprintHash"],
  );
  assert.equal(
    document.components.schemas.HumanAuthorization.properties.schemaVersion.const,
    "1.0.0",
  );
  assert.match(source, /ActualEffects:\s+[\s\S]{0,100}additionalProperties: false/);

  const authorizeRequest = source.slice(
    source.indexOf("    AuthorizeRequest:"),
    source.indexOf("    RecordExecutionRequest:"),
  );
  assert.match(authorizeRequest, /method: \{ const: PARTNER_AUTHENTICATED \}/);
  assert.doesNotMatch(authorizeRequest, /EIP712/);
});

test("OpenAPI health schema matches the raw runtime response exactly", async () => {
  const { document } = await loadOpenApi();
  assert.equal(
    document.paths["/health"].get.responses["200"].$ref,
    "#/components/responses/HealthResponse",
  );
  assert.equal(
    document.components.responses.HealthResponse.content["application/json"].schema.$ref,
    "#/components/schemas/HealthResponse",
  );
  const schema = document.components.schemas.HealthResponse;
  assert.equal(schema.additionalProperties, false);

  const { GET: health } = await import("../../app/health/route.ts");
  const response = await health(new Request("https://ryntra.test/health"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), [...schema.required].sort());

  for (const [key, value] of Object.entries(body)) {
    const property = schema.properties[key];
    assert.ok(property, `HealthResponse property is undocumented: ${key}`);
    if (Object.hasOwn(property, "const")) assert.equal(value, property.const, key);
    if (property.enum) assert.ok(property.enum.includes(value), `${key} is outside its enum`);
    const allowedTypes = Array.isArray(property.type) ? property.type : [property.type];
    const actualType = value === null ? "null" : typeof value;
    if (property.type) assert.ok(allowedTypes.includes(actualType), `${key} has type ${actualType}`);
    if (property.format === "date-time") assert.equal(Number.isFinite(Date.parse(value)), true, key);
    if (property.minLength) assert.ok(value.length >= property.minLength, key);
  }
});

test("OpenAPI reconciliation branches match runtime confirmed and uncertain semantics", async () => {
  const { document } = await loadOpenApi();
  const schemas = document.components.schemas;
  const reconcile = schemas.ReconcileExecutionRequest;
  assert.deepEqual(reconcile.oneOf, [
    { $ref: "#/components/schemas/ConfirmedReconcileExecutionRequest" },
    { $ref: "#/components/schemas/UncertainReconcileExecutionRequest" },
  ]);
  assert.deepEqual(reconcile.discriminator, {
    propertyName: "observedState",
    mapping: {
      CONFIRMED: "#/components/schemas/ConfirmedReconcileExecutionRequest",
      RPC_UNCERTAIN_AFTER_BROADCAST:
        "#/components/schemas/UncertainReconcileExecutionRequest",
    },
  });

  const confirmed = schemas.ConfirmedReconcileExecutionRequest;
  const uncertain = schemas.UncertainReconcileExecutionRequest;
  assert.equal(confirmed.additionalProperties, false);
  assert.equal(uncertain.additionalProperties, false);
  assert.deepEqual(confirmed.required, [
    "operation",
    "transactionHash",
    "observedState",
    "observedAt",
    "actualOutcome",
  ]);
  assert.deepEqual(uncertain.required, ["operation", "transactionHash", "observedState"]);
  assert.equal(confirmed.properties.observedState.const, "CONFIRMED");
  assert.equal(
    uncertain.properties.observedState.const,
    "RPC_UNCERTAIN_AFTER_BROADCAST",
  );
  assert.ok(uncertain.properties.observedAt);
  assert.ok(uncertain.properties.actualOutcome);

  const transactionHash = `0x${"ab".repeat(32)}`;
  const observedAt = "2026-08-08T12:00:00.000Z";
  const actualOutcome = {
    amountIn: "10.00",
    amountOut: "9.95",
    feeAmount: "0.02",
    explorerUrl: `https://testnet.arcscan.app/tx/${transactionHash}`,
  };
  const cases = [
    {
      body: { operation: "RECONCILE", transactionHash, observedState: "CONFIRMED", observedAt, actualOutcome },
      accepted: true,
    },
    {
      body: { operation: "RECONCILE", transactionHash, observedState: "CONFIRMED", actualOutcome },
      accepted: false,
    },
    {
      body: { operation: "RECONCILE", transactionHash, observedState: "CONFIRMED", observedAt },
      accepted: false,
    },
    {
      body: { operation: "RECONCILE", transactionHash, observedState: "RPC_UNCERTAIN_AFTER_BROADCAST" },
      accepted: true,
    },
    {
      body: { operation: "RECONCILE", transactionHash, observedState: "RPC_UNCERTAIN_AFTER_BROADCAST", observedAt, actualOutcome },
      accepted: true,
    },
  ];
  const acceptsDocumentedBranch = (body) => {
    const branch = body.observedState === "CONFIRMED" ? confirmed : uncertain;
    return (
      branch.required.every((field) => Object.hasOwn(body, field)) &&
      Object.keys(body).every((field) => Object.hasOwn(branch.properties, field)) &&
      branch.properties.observedState.const === body.observedState
    );
  };
  const { ReconcileExecutionRequestSchema } = await import("./api.ts");
  for (const { body, accepted } of cases) {
    assert.equal(ReconcileExecutionRequestSchema.safeParse(body).success, accepted);
    assert.equal(acceptsDocumentedBranch(body), accepted);
  }

  const { source } = await loadOpenApi();
  assert.match(
    source,
    /required: \[provider, sourceRef, verificationStatus, observedAt, responseDigest\]/,
  );
});

test("the partner example uses the headless SDK and leaves wallet execution outside Ryntra", async () => {
  const source = await readFile(new URL("../../examples/partner-arc-app/server-flow.ts", import.meta.url), "utf8");
  assert.match(source, /RyntraGuardClient/);
  assert.match(source, /client\.intents\.create/);
  assert.match(source, /client\.preflight/);
  assert.match(source, /client\.authorize/);
  assert.match(source, /client\.executions\.record/);
  assert.match(source, /transactionHash/);
  assert.doesNotMatch(source, /privateKey|seedPhrase|wallet\.execute/i);
});
