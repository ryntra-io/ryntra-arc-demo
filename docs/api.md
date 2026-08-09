# Ryntra Guard API v1

This contract exposes provider-neutral decision and settlement evidence. `evidenceStatus`, `policyDecision`, `authorizationStatus`, `executionStatus`, and `reconciliationStatus` are independently serialized; clients must not infer one from another.

## Server-to-server contract

```http
POST /v1/intents
GET  /v1/intents?limit=50
GET  /v1/intents/{intentId}
POST /v1/intents/{intentId}/preflight
GET  /v1/evaluations/{evaluationId}
POST /v1/intents/{intentId}/authorize
POST /v1/intents/{intentId}/executions
GET  /v1/intents/{intentId}/status
GET  /v1/intents/{intentId}/receipt
GET  /v1/capabilities
GET  /health
```

The machine-readable contract is [ryntra-guard-v1.yaml](../../openapi/ryntra-guard-v1.yaml). The private headless SDK example is under `packages/guard-sdk`; the partner-style server example is `examples/partner-arc-app/server-flow.ts`. The package is not published to npm.

## Security contract

- Bearer authentication is server-to-server only.
- `RYNTRA_GUARD_DEMO_API_KEY` and `RYNTRA_GUARD_DEMO_TENANT_ID` must both exist or the API fails closed.
- Every state-changing request requires a bounded `Idempotency-Key`.
- An idempotency key is scoped to tenant and operation; same key/same payload replays the original result, while changed payload returns `IDEMPOTENCY_CONFLICT`.
- Confirmed reconciliation requires an attributed `observedAt` with exact ordering: `authorization.createdAt <= observedAt <= authorization.expiresAt` and `observedAt <= now`. There is no retroactive clock-skew allowance; an earlier or future observation cannot finalize a receipt.
- Correlation IDs are accepted only in a bounded character set or generated server-side.
- Requests are JSON-only and bounded to 64 KiB.
- Private/no-store headers are returned.
- The SDK never accepts or manages a wallet private key.

## Stable error shape

```json
{
  "error": {
    "code": "EVALUATION_EXPIRED",
    "message": "The readiness evaluation has expired.",
    "retryable": true,
    "requiredAction": "CREATE_NEW_EVALUATION",
    "correlationId": "corr_..."
  }
}
```

Implemented codes include validation, authentication, tenant isolation, capability unavailable, insufficient evidence, policy block, authorization required/expired, evaluation expired, fingerprint mismatch, idempotency conflict, unconfirmed execution, recovery/reconciliation required, and rate limiting.

## Prototype browser boundary

`/api/arc-guard` exists only for the reference client. It uses an opaque HttpOnly session, same-origin calls, strict rate limiting, a fixed Arc Testnet policy, and a server-only Circle App Kit estimate credential. The anonymous route can estimate and prepare unsigned preflight material, but it cannot authorize, record execution, or reconcile a transaction; those mutations require the authenticated `/v1` partner API. The cookie is not partner authentication or wallet-ownership proof, and this route must not be represented as multi-tenant production infrastructure.

## Small TypeScript integration example

```ts
const intent = await ryntra.intents.create<{ id: string }>(input, {
  idempotencyKey: "create-order-001",
});
const evaluation = await ryntra.preflight<{
  id: string;
  evidenceStatus: string;
  policyDecision: string;
  authorizationStatus: string;
  executionStatus: string;
  reconciliationStatus: string;
}>(intent.id, { evidence: [evidence] }, {
  idempotencyKey: "preflight-order-001",
});

if (evaluation.policyDecision === "BLOCKED_BY_RULE") return showBlockers(evaluation);
if (evaluation.evidenceStatus !== "COMPLETE") return showMissing(evaluation);

const authorization = await ryntra.authorize({
  intentId: intent.id,
  evaluationId: evaluation.id,
  fingerprint,
  subjectRef,
  method: "PARTNER_AUTHENTICATED",
}, { idempotencyKey: "authorize-order-001" });

// The partner wallet signs and broadcasts. Ryntra never receives its key.
```

## Known API limitations

Persistence is configuration, and the API reports it rather than assuming it. With the default `memory` store the lifecycle is lost on cold start; with `RYNTRA_GUARD_STORE=file` plus `RYNTRA_GUARD_STORE_DIR`, source and local tests cover single-writer restart persistence; with `RYNTRA_GUARD_STORE=postgres` plus `DATABASE_URL`, the adapter is designed for cold starts and concurrent writers. `GET /v1/intents/{intentId}/status` returns the exact adapter limitation in `limitations`, and `GET /health` returns `persistence`, `deployment`, and `stateChangesAccepted`.

`RYNTRA_GUARD_STORE=postgres` with `DATABASE_URL` is the only configuration the source accepts for multi-instance state changes. Any other store returns `503 CAPABILITY_UNAVAILABLE` there for every state-changing call, with `requiredAction: CONFIGURE_DURABLE_MULTI_WRITER_GUARD_STORE`; reads stay available so the reason is visible.

The live Postgres test suite was not run in this audit because `DATABASE_URL` is unavailable. Therefore the round-trip, concurrent-claim, shared-state, and tenant-isolation behavior of the current exact candidate is not independently proven here. Tenant scoping is enforced by key prefix inside one shared table; production partner use additionally requires database-level tenant isolation.

The App Kit swap estimate is request-bound rather than exact-calldata-bound and therefore cannot yet proceed to wallet execution. It remains unverified end to end.

The separate direct-EOA ERC-20 USDC fallback has one recorded owner-authorized Arc Public Testnet run: transaction [`0x6476dc81a38f0cbe385eab5162f391d7954a992a443db7d268e07b2698b8d5f9`](https://testnet.arcscan.app/tx/0x6476dc81a38f0cbe385eab5162f391d7954a992a443db7d268e07b2698b8d5f9), block `55677295`, successful receipt at `2026-08-06T22:19:23Z`, and reconciliation `MATCHED`. That historical evidence verifies only the exact recorded transfer. It is not a repeatability, deployment, or production claim.

The public API/demo deployment currently answers, but its deployed source SHA has not been proven against the corrected candidate. A fresh exact-candidate CI run is also required: the run for `342daa0` stopped at `npm ci`, so it did not verify lint, tests, or build.
