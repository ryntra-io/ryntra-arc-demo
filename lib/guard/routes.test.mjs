// Run from repo root: node --test lib/guard/routes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

const routeFiles = [
  "../../app/v1/intents/route.ts",
  "../../app/v1/intents/[intentId]/route.ts",
  "../../app/v1/intents/[intentId]/preflight/route.ts",
  "../../app/v1/evaluations/[evaluationId]/route.ts",
  "../../app/v1/intents/[intentId]/authorize/route.ts",
  "../../app/v1/intents/[intentId]/executions/route.ts",
  "../../app/v1/intents/[intentId]/status/route.ts",
  "../../app/v1/intents/[intentId]/receipt/route.ts",
  "../../app/v1/capabilities/route.ts",
  "../../app/health/route.ts",
];

test("the exact versioned Guard endpoint files exist", async () => {
  for (const file of routeFiles) await access(new URL(file, import.meta.url));
});

test("health and capability routes disclose prototype truth without authentication", async () => {
  const [{ GET: health }, { GET: capabilities }] = await Promise.all([
    import("../../app/health/route.ts"),
    import("../../app/v1/capabilities/route.ts"),
  ]);
  const healthResponse = await health(new Request("https://ryntra.test/health"));
  assert.equal(healthResponse.status, 200);
  /* Persistence and deployment are reported from the configured adapter. Under
     `node --test` no store is configured, so the honest answer is the ephemeral
     one — and a reviewer must be able to read that from /health rather than
     infer it. */
  const { RECORDED_RUN } = await import("../../app/arc/arc-project.ts");
  const { getArcVerificationStatus } = await import("./arc-verification.ts");
  const arcStatus = getArcVerificationStatus();
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    service: "ryntra-guard",
    environment: "ARC_TESTNET",
    persistence: "EPHEMERAL_SINGLE_INSTANCE",
    persistenceDetail: "in-process memory (demo only; lost on cold start)",
    deployment: "SINGLE_INSTANCE",
    stateChangesAccepted: true,
    /* Derived from the recorded proof, not pinned to a literal. The previous
       version asserted `NOT_VERIFIED` and kept passing the day after Gate B —
       a test that pins a constant cannot notice the world changed, and this
       one had already helped a stale capability survive on three surfaces. */
    liveArcExecution: arcStatus.state,
    verifiedOperation: arcStatus.isCurrent
      ? "EOA_USDC_ERC20_TREASURY_TRANSFER"
      : null,
    recordedOperation: "EOA_USDC_ERC20_TREASURY_TRANSFER",
    recordedAt: RECORDED_RUN.blockTimestamp,
    /* Unconditional: whatever the transfer proved, the swap is not covered. */
    swapExecution: "NOT_VERIFIED",
  });
  const capabilityResponse = await capabilities(new Request("https://ryntra.test/v1/capabilities"));
  assert.equal(capabilityResponse.status, 200);
  const capabilityBody = await capabilityResponse.json();
  assert.equal(capabilityBody.data.some((entry) => entry.state === "LIVE" && entry.environment === "PRODUCTION"), false);
  assert.deepEqual(capabilityBody.limitations, [
    "ARC_TESTNET",
    "HACKATHON_PROTOTYPE",
    ...(arcStatus.isCurrent
      ? ["TESTNET_VERIFIED_DIRECT_EOA_ERC20_USDC_TRANSFER_ONLY"]
      : ["RECORDED_RUN_REQUIRES_REVERIFICATION"]),
    "SWAP_NOT_VERIFIED",
    "GATE_C_NOT_COMPLETE",
  ]);
  assert.equal(
    capabilityBody.data.find((entry) => entry.id === "arc-eoa-usdc-transfer")?.state,
    arcStatus.state,
  );
});

test("authenticated intent and preflight routes enforce tenant scope and structured errors", async () => {
  process.env.RYNTRA_GUARD_DEMO_API_KEY = "test-server-secret";
  process.env.RYNTRA_GUARD_DEMO_TENANT_ID = "tenant_route_test";
  const [{ POST: createIntent }, { GET: getIntent }, { POST: preflight }] = await Promise.all([
    import("../../app/v1/intents/route.ts"),
    import("../../app/v1/intents/[intentId]/route.ts"),
    import("../../app/v1/intents/[intentId]/preflight/route.ts"),
  ]);

  const now = Date.now();
  const observedAt = new Date(now - 1_000).toISOString();
  const validUntil = new Date(now + 60_000).toISOString();
  const body = {
    applicationId: "partner_arc_app",
    externalPartnerId: "route-test-order",
    subjectRef: "subject:route-test",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletType: "EOA",
    chainRef: "eip155:5042002",
    environment: "ARC_TESTNET",
    actionType: "SWAP",
    instrumentRef: "arc-testnet:stablecoin-fx:usdc-eurc",
    sellAssetRef: "eip155:5042002/erc20:0x3600000000000000000000000000000000000000",
    buyAssetRef: "eip155:5042002/erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a",
    amount: "10.00",
    amountType: "EXACT_INPUT",
    recipient: "0x1111111111111111111111111111111111111111",
    venueRef: "circle-app-kit",
    routeRef: "circle-app-kit:swap:Arc_Testnet",
    quoteRef: "quote_route_test",
    target: "0x2222222222222222222222222222222222222222",
    calldataHash: `0x${"ab".repeat(32)}`,
    nativeValue: "0",
    portfolioSnapshotRef: null,
    policyRef: { id: "demo-stablecoin-policy", version: 1 },
    expiresAt: new Date(now + 120_000).toISOString(),
  };
  const headers = {
    authorization: "Bearer test-server-secret",
    "content-type": "application/json",
    "idempotency-key": "idem-route-create-001",
    "x-correlation-id": "corr-route-create-001",
  };
  const createdResponse = await createIntent(
    new Request("https://ryntra.test/v1/intents", { method: "POST", headers, body: JSON.stringify(body) }),
  );
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get("x-correlation-id"), "corr-route-create-001");
  const created = (await createdResponse.json()).data;

  const replayedResponse = await createIntent(
    new Request("https://ryntra.test/v1/intents", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  assert.equal(replayedResponse.status, 201);
  const replayed = (await replayedResponse.json()).data;
  assert.equal(replayed.id, created.id);
  assert.equal(replayed.createdAt, created.createdAt);
  assert.equal(replayed.idempotentReplay, true);

  const unauthorized = await getIntent(
    new Request(`https://ryntra.test/v1/intents/${created.id}`),
    { params: Promise.resolve({ intentId: created.id }) },
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "AUTHENTICATION_REQUIRED");

  const fetched = await getIntent(
    new Request(`https://ryntra.test/v1/intents/${created.id}`, { headers: { authorization: "Bearer test-server-secret" } }),
    { params: Promise.resolve({ intentId: created.id }) },
  );
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).data.tenantId, "tenant_route_test");

  const evidence = {
    schemaVersion: "1.0.0",
    id: "ev_route_test",
    provider: "Circle App Kit",
    sourceRef: "circle-app-kit:estimateSwap",
    adapter: "circle-app-kit",
    adapterVersion: "1.11.0",
    sourceType: "SWAP_QUOTE",
    observedAt,
    receivedAt: observedAt,
    validUntil,
    confidence: "PROVIDER_REPORTED",
    coverage: {
      subjectRefs: ["eip155:5042002", body.sellAssetRef, body.buyAssetRef],
      fields: ["amountIn", "expectedAmountOut", "minimumAmountOut", "fees"],
      limitations: ["UNDERLYING_ROUTE_UNAVAILABLE"],
    },
    availability: "AVAILABLE",
    verificationStatus: "PROVIDER_REPORTED",
    chainRef: "eip155:5042002",
    blockRef: null,
    transactionRef: null,
    status: "VALID",
    requestHash: `0x${"01".repeat(32)}`,
    responseHash: `0x${"02".repeat(32)}`,
    responseDigest: `0x${"02".repeat(32)}`,
    reason: null,
    transformationVersion: "arc-app-kit-estimate-v1",
    fallbackUsed: false,
    facts: {
      quoteRef: "quote_route_test",
      providerRef: "circle-app-kit",
      routeRef: "circle-app-kit:swap:Arc_Testnet",
      venueRef: "circle-app-kit",
      recipientAddress: body.recipient,
      sellAssetRef: body.sellAssetRef,
      buyAssetRef: body.buyAssetRef,
      amountIn: "10.00",
      expectedAmountOut: "9.96",
      minimumAmountOut: "9.94",
      feeAmount: "0.02",
      feeAssetRef: body.sellAssetRef,
      totalDebit: "10.02",
      slippageBps: "20",
    },
  };
  const preflightResponse = await preflight(
    new Request(`https://ryntra.test/v1/intents/${created.id}/preflight`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "idem-route-preflight-001" },
      body: JSON.stringify({ evidence: [evidence] }),
    }),
    { params: Promise.resolve({ intentId: created.id }) },
  );
  assert.equal(preflightResponse.status, 200);
  const evaluation = (await preflightResponse.json()).data;
  assert.equal(evaluation.outcome, "ALLOWED_BY_POLICY");
  assert.equal("_evidence" in evaluation, false);

  const { buildArcUsdcTransferIntent, prepareArcUsdcTreasuryTransfer } = await import(
    "./arc-usdc-transfer.ts"
  );
  const sendPrepared = await prepareArcUsdcTreasuryTransfer({
    request: {
      walletType: "EOA",
      walletAddress: body.walletAddress,
      recipientAddress: "0x3333333333333333333333333333333333333333",
      amount: "1.00",
    },
    collectOnchainState: async () => ({
      chainId: 5_042_002,
      blockNumber: "55677295",
      contractCodeDigest: `0x${"03".repeat(32)}`,
      decimals: 6,
      tokenBalanceBaseUnits: "2000000",
      nativeBalanceBaseUnits: "1000065000000000000",
      gasLimit: "65000",
      gasPriceBaseUnits: "1000000000",
    }),
    now: () => new Date(now).toISOString(),
  });
  const sendIntent = buildArcUsdcTransferIntent({
    tenantId: "tenant_route_test",
    intentId: "int_route_send_placeholder",
    idempotencyKey: "route-send-placeholder",
    prepared: sendPrepared,
    createdAt: new Date(now).toISOString(),
  });
  const sendBody = { ...sendIntent };
  for (const serverOwned of [
    "schemaVersion",
    "id",
    "tenantId",
    "createdAt",
    "revision",
    "idempotencyKey",
  ]) {
    delete sendBody[serverOwned];
  }
  const sendHeaders = { ...headers, "idempotency-key": "idem-route-create-send-001" };
  const sendCreatedResponse = await createIntent(
    new Request("https://ryntra.test/v1/intents", {
      method: "POST",
      headers: sendHeaders,
      body: JSON.stringify(sendBody),
    }),
  );
  assert.equal(sendCreatedResponse.status, 201);
  const sendCreated = (await sendCreatedResponse.json()).data;
  const sendPreflightResponse = await preflight(
    new Request(`https://ryntra.test/v1/intents/${sendCreated.id}/preflight`, {
      method: "POST",
      headers: { ...sendHeaders, "idempotency-key": "idem-route-preflight-send-001" },
      body: JSON.stringify({ evidence: [sendPrepared.evidence] }),
    }),
    { params: Promise.resolve({ intentId: sendCreated.id }) },
  );
  assert.equal(sendPreflightResponse.status, 200);
  assert.equal((await sendPreflightResponse.json()).data.outcome, "ALLOWED_BY_POLICY");

  const unsupportedBody = {
    ...sendBody,
    externalPartnerId: "route-test-unsupported-policy",
    policyRef: { id: "unknown-server-policy", version: 1 },
  };
  const unsupportedHeaders = {
    ...headers,
    "idempotency-key": "idem-route-create-unsupported-policy",
  };
  const unsupportedCreatedResponse = await createIntent(
    new Request("https://ryntra.test/v1/intents", {
      method: "POST",
      headers: unsupportedHeaders,
      body: JSON.stringify(unsupportedBody),
    }),
  );
  assert.equal(unsupportedCreatedResponse.status, 201);
  const unsupportedCreated = (await unsupportedCreatedResponse.json()).data;
  const unsupportedPreflight = await preflight(
    new Request(`https://ryntra.test/v1/intents/${unsupportedCreated.id}/preflight`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "idem-route-preflight-unsupported-policy" },
      body: JSON.stringify({ evidence: [sendPrepared.evidence] }),
    }),
    { params: Promise.resolve({ intentId: unsupportedCreated.id }) },
  );
  assert.equal(unsupportedPreflight.status, 503);
  assert.equal((await unsupportedPreflight.json()).error.code, "CAPABILITY_UNAVAILABLE");
});

test("authenticated Arc transfer policy rejects caller-selected target and calldata", async () => {
  process.env.RYNTRA_GUARD_DEMO_API_KEY = "test-server-secret";
  process.env.RYNTRA_GUARD_DEMO_TENANT_ID = "tenant_route_binding";
  const [{ POST: createIntent }, { POST: preflight }, transferModule] = await Promise.all([
    import("../../app/v1/intents/route.ts"),
    import("../../app/v1/intents/[intentId]/preflight/route.ts"),
    import("./arc-usdc-transfer.ts"),
  ]);
  const now = Date.now();
  const prepared = await transferModule.prepareArcUsdcTreasuryTransfer({
    request: {
      walletType: "EOA",
      walletAddress: "0x1111111111111111111111111111111111111111",
      recipientAddress: "0x3333333333333333333333333333333333333333",
      amount: "1.00",
    },
    collectOnchainState: async () => ({
      chainId: 5_042_002,
      blockNumber: "55677295",
      contractCodeDigest: `0x${"03".repeat(32)}`,
      decimals: 6,
      tokenBalanceBaseUnits: "2000000",
      nativeBalanceBaseUnits: "1000065000000000000",
      gasLimit: "65000",
      gasPriceBaseUnits: "1000000000",
    }),
    now: () => new Date(now).toISOString(),
  });
  const canonicalIntent = transferModule.buildArcUsdcTransferIntent({
    tenantId: "tenant_route_binding",
    intentId: "int_route_binding_placeholder",
    idempotencyKey: "route-binding-placeholder",
    prepared,
    createdAt: new Date(now).toISOString(),
  });
  const canonicalBody = { ...canonicalIntent };
  for (const serverOwned of [
    "schemaVersion",
    "id",
    "tenantId",
    "createdAt",
    "revision",
    "idempotencyKey",
  ]) {
    delete canonicalBody[serverOwned];
  }
  const headers = {
    authorization: "Bearer test-server-secret",
    "content-type": "application/json",
    "x-correlation-id": "corr-route-binding",
  };
  const cases = [
    {
      name: "target",
      intent: {
        ...canonicalBody,
        externalPartnerId: "route-binding-arbitrary-target",
        target: "0x4444444444444444444444444444444444444444",
      },
      evidence: {
        ...prepared.evidence,
        id: "ev_route_binding_arbitrary_target",
        facts: {
          ...prepared.evidence.facts,
          tokenAddress: "0x4444444444444444444444444444444444444444",
        },
      },
    },
    {
      name: "calldata",
      intent: {
        ...canonicalBody,
        externalPartnerId: "route-binding-arbitrary-calldata",
        calldataHash: `0x${"55".repeat(32)}`,
      },
      evidence: {
        ...prepared.evidence,
        id: "ev_route_binding_arbitrary_calldata",
        facts: {
          ...prepared.evidence.facts,
          calldataHash: `0x${"55".repeat(32)}`,
        },
      },
    },
  ];

  for (const scenario of cases) {
    const createResponse = await createIntent(
      new Request("https://ryntra.test/v1/intents", {
        method: "POST",
        headers: { ...headers, "idempotency-key": `route-binding-create-${scenario.name}` },
        body: JSON.stringify(scenario.intent),
      }),
    );
    assert.equal(createResponse.status, 201, scenario.name);
    const created = (await createResponse.json()).data;
    const preflightResponse = await preflight(
      new Request(`https://ryntra.test/v1/intents/${created.id}/preflight`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": `route-binding-preflight-${scenario.name}` },
        body: JSON.stringify({ evidence: [scenario.evidence] }),
      }),
      { params: Promise.resolve({ intentId: created.id }) },
    );
    assert.equal(preflightResponse.status, 409, scenario.name);
    assert.equal((await preflightResponse.json()).error.code, "FINGERPRINT_MISMATCH", scenario.name);
  }
});

test("a multi-instance deployment without a multi-writer store refuses every state change", async () => {
  /* The runtime is cached per process, so the deployment shape is swapped and
     the cache cleared around this test. What is asserted is the rule the packet
     turns on: an ephemeral store behind several instances must fail closed with
     a structured error, never accept an intent it will lose. */
  process.env.RYNTRA_GUARD_DEMO_API_KEY = "test-server-secret";
  process.env.RYNTRA_GUARD_DEMO_TENANT_ID = "tenant_route_test";
  const previousDeployment = process.env.RYNTRA_GUARD_DEPLOYMENT;
  const previousRuntime = globalThis.__ryntraGuardPrototypeRuntime;
  process.env.RYNTRA_GUARD_DEPLOYMENT = "multi-instance";
  delete globalThis.__ryntraGuardPrototypeRuntime;

  try {
    const { POST: createIntent } = await import("../../app/v1/intents/route.ts");
    const blocked = await createIntent(
      new Request("https://ryntra.test/v1/intents", {
        method: "POST",
        headers: {
          authorization: "Bearer test-server-secret",
          "content-type": "application/json",
          "idempotency-key": "idem-route-durability-001",
        },
        body: JSON.stringify({ amount: "10.00" }),
      }),
    );
    assert.equal(blocked.status, 503);
    const body = await blocked.json();
    assert.equal(body.error.code, "CAPABILITY_UNAVAILABLE");
    assert.equal(body.error.requiredAction, "CONFIGURE_DURABLE_MULTI_WRITER_GUARD_STORE");
    assert.match(body.error.message, /multi-instance deployment/i);

    // Reads stay available so a reviewer can still see why writes are refused.
    const { GET: health } = await import("../../app/health/route.ts");
    const healthBody = await (await health(new Request("https://ryntra.test/health"))).json();
    assert.equal(healthBody.deployment, "MULTI_INSTANCE");
    assert.equal(healthBody.stateChangesAccepted, false);
  } finally {
    if (previousDeployment === undefined) delete process.env.RYNTRA_GUARD_DEPLOYMENT;
    else process.env.RYNTRA_GUARD_DEPLOYMENT = previousDeployment;
    if (previousRuntime === undefined) delete globalThis.__ryntraGuardPrototypeRuntime;
    else globalThis.__ryntraGuardPrototypeRuntime = previousRuntime;
  }
});
