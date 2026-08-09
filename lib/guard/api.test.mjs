// Run from repo root: node --test lib/guard/api.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { RECORDED_RUN } from "../../app/arc/arc-project.ts";

const WALLET = "0x1111111111111111111111111111111111111111";
const REQUEST_HASH = `0x${"aa".repeat(32)}`;

async function loadApi() {
  try {
    return await import("./api.ts");
  } catch (error) {
    assert.fail(`Guard API boundary is missing: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test("API authentication fails closed and never accepts a missing server credential", async () => {
  const { authenticateGuardApi, isGuardApiError } = await loadApi();
  assert.throws(
    () =>
      authenticateGuardApi({
        authorization: "Bearer browser-leaked-value",
        configuredApiKey: undefined,
        configuredTenantId: "tenant_demo",
      }),
    (error) => isGuardApiError(error, "CAPABILITY_UNAVAILABLE"),
  );
  assert.throws(
    () =>
      authenticateGuardApi({
        authorization: null,
        configuredApiKey: "server-secret",
        configuredTenantId: "tenant_demo",
      }),
    (error) => isGuardApiError(error, "AUTHENTICATION_REQUIRED"),
  );
  assert.equal(
    authenticateGuardApi({
      authorization: "Bearer server-secret",
      configuredApiKey: "server-secret",
      configuredTenantId: "tenant_demo",
    }).tenantId,
    "tenant_demo",
  );
});

test("correlation and idempotency identifiers are bounded and explicit", async () => {
  const { correlationIdFromHeader, requireIdempotencyKey } = await loadApi();
  assert.equal(correlationIdFromHeader("partner:corr-1234", () => "generated"), "partner:corr-1234");
  assert.equal(correlationIdFromHeader("bad space", () => "generated"), "generated");
  assert.equal(requireIdempotencyKey("idem-create-001"), "idem-create-001");
  assert.throws(() => requireIdempotencyKey(null));
});

test("a streamed body without Content-Length is cancelled before buffering beyond 64 KiB", async () => {
  const { GUARD_MAX_BODY_BYTES, isGuardApiError, readBoundedGuardJson } = await loadApi();
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(24 * 1024).fill(0x20));
      if (pulls === 10) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/v1/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });

  assert.equal(request.headers.has("content-length"), false);
  await assert.rejects(
    () => readBoundedGuardJson(request),
    (error) => isGuardApiError(error, "VALIDATION_ERROR") && /exceeds/.test(error.message),
  );
  assert.equal(cancelled, true);
  assert.ok(pulls < 10);
  assert.ok(pulls * 24 * 1024 <= GUARD_MAX_BODY_BYTES + 2 * 24 * 1024);
});

test("server-owned metadata cannot be overridden and financial numbers stay strings", async () => {
  const { createIntentFromApiInput, isGuardApiError } = await loadApi();
  const body = {
    tenantId: "attacker-tenant",
    id: "attacker-id",
    applicationId: "partner_arc_app",
    externalPartnerId: "partner-order-001",
    subjectRef: "subject:demo",
    walletAddress: WALLET,
    walletType: "EOA",
    chainRef: "eip155:5042002",
    environment: "ARC_TESTNET",
    actionType: "SWAP",
    instrumentRef: "arc-testnet:stablecoin-fx:usdc-eurc",
    sellAssetRef: "eip155:5042002/erc20:0x3600000000000000000000000000000000000000",
    buyAssetRef: "eip155:5042002/erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a",
    amount: "10.00",
    amountType: "EXACT_INPUT",
    recipient: WALLET,
    venueRef: "circle-app-kit",
    routeRef: "circle-app-kit:swap:Arc_Testnet",
    quoteRef: "quote_arc_001",
    executionBindingKind: "APP_KIT_REQUEST",
    target: null,
    calldataHash: null,
    nativeValue: "0",
    adapterRequestHash: REQUEST_HASH,
    productionCalldataBound: false,
    portfolioSnapshotRef: null,
    policyRef: { id: "demo-stablecoin-policy", version: 1 },
    expiresAt: "2026-08-06T12:02:00.000Z",
  };
  const intent = createIntentFromApiInput({
    body,
    tenantId: "tenant_demo",
    idempotencyKey: "idem-create-001",
    now: "2026-08-06T12:00:00.000Z",
    intentId: "int_server_001",
  });
  assert.equal(intent.tenantId, "tenant_demo");
  assert.equal(intent.id, "int_server_001");
  assert.equal(intent.amount, "10.00");
  assert.throws(
    () => createIntentFromApiInput({ ...intent, body: { ...body, amount: 10 } }),
    (error) => isGuardApiError(error, "VALIDATION_ERROR"),
  );
});

test("confirmed reconciliation requires an attributed observation time", async () => {
  const { parseExecutionRequest, isGuardApiError } = await loadApi();
  const confirmed = {
    operation: "RECONCILE",
    transactionHash: `0x${"ab".repeat(32)}`,
    observedState: "CONFIRMED",
    actualOutcome: {
      amountIn: "10.00",
      amountOut: "9.95",
      feeAmount: "0.02",
      explorerUrl: `https://testnet.arcscan.app/tx/0x${"ab".repeat(32)}`,
    },
  };
  assert.throws(
    () => parseExecutionRequest(confirmed),
    (error) => isGuardApiError(error, "VALIDATION_ERROR"),
  );
  assert.equal(
    parseExecutionRequest({
      ...confirmed,
      observedAt: "2026-08-08T12:00:00.000Z",
    }).observedAt,
    "2026-08-08T12:00:00.000Z",
  );
  for (const actualOutcome of [
    { ...confirmed.actualOutcome, amountOut: "1".repeat(129) },
    {
      ...confirmed.actualOutcome,
      explorerUrl: `https://testnet.arcscan.app/tx/0x${"cd".repeat(32)}`,
    },
  ]) {
    assert.throws(
      () =>
        parseExecutionRequest({
          ...confirmed,
          observedAt: "2026-08-08T12:00:00.000Z",
          actualOutcome,
        }),
      (error) => isGuardApiError(error, "VALIDATION_ERROR"),
    );
  }
});

test("structured errors expose stable remediation without leaking request secrets", async () => {
  const { GuardApiError, structuredGuardError } = await loadApi();
  const response = structuredGuardError(
    new GuardApiError("EVALUATION_EXPIRED", "The readiness evaluation is no longer valid.", {
      retryable: true,
      requiredAction: "CREATE_NEW_EVALUATION",
    }),
    "corr_test_001",
  );
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: "EVALUATION_EXPIRED",
      message: "The readiness evaluation is no longer valid.",
      retryable: true,
      requiredAction: "CREATE_NEW_EVALUATION",
      correlationId: "corr_test_001",
    },
  });
});

test("the public capability response projects the recorded Arc proof without promoting the swap or production", async () => {
  const { getGuardCapabilities, guardCapabilities } = await loadApi();
  const guardApi = guardCapabilities.find((entry) => entry.id === "guard-api-sdk-v1");
  assert.equal(guardApi.ryntraImplementationCapability, "SOURCE_IMPLEMENTED_DEPLOYMENT_PARITY_UNVERIFIED");
  assert.match(guardApi.evidenceSource, /ryntra-arc-testnet\.vercel\.app\/v1\/capabilities/);
  assert.match(guardApi.evidenceSource, /deployed SHA are unverified/);
  const arcSwap = guardCapabilities.find((entry) => entry.id === "arc-app-kit-usdc-eurc-swap");
  assert.equal(arcSwap.state, "UNVERIFIED");
  assert.equal(arcSwap.environment, "ARC_TESTNET");
  assert.equal(arcSwap.protocolCapability, "DOCUMENTED_BY_PROVIDER");
  assert.equal(arcSwap.ryntraImplementationCapability, "IMPLEMENTED_NOT_LIVE_VERIFIED");
  assert.equal(arcSwap.currentWalletCapability, "UNVERIFIED");
  const arcTransfer = guardCapabilities.find((entry) => entry.id === "arc-eoa-usdc-transfer");
  assert.equal(arcTransfer.state, "TESTNET_VERIFIED");
  assert.equal(arcTransfer.ryntraImplementationCapability, "TESTNET_VERIFIED_ONE_RECORDED_RUN");
  assert.equal(arcTransfer.currentWalletCapability, "RECORDED_OWNER_WALLET_ONLY");
  assert.equal(arcTransfer.verifiedAt, RECORDED_RUN.blockTimestamp);
  assert.match(arcTransfer.evidenceSource, new RegExp(RECORDED_RUN.transactionHash));
  assert.match(arcTransfer.evidenceSource, /direct-EOA ERC-20 USDC transfer only/);
  const agedTransfer = getGuardCapabilities(new Date("2027-01-01T00:00:00.000Z"))
    .find((entry) => entry.id === "arc-eoa-usdc-transfer");
  assert.equal(agedTransfer.state, "RE_VERIFYING");
  assert.equal(agedTransfer.ryntraImplementationCapability, "RE_VERIFYING_RECORDED_RUN");
  assert.equal(guardCapabilities.some((entry) => entry.environment === "PRODUCTION" && entry.state === "LIVE"), false);
});

test("the public authorization request cannot claim unverified EIP-712 approval", async () => {
  const { AuthorizeRequestSchema } = await loadApi();
  assert.equal(AuthorizeRequestSchema.shape.method.safeParse("PARTNER_AUTHENTICATED").success, true);
  assert.equal(AuthorizeRequestSchema.shape.method.safeParse("EIP712").success, false);
});
