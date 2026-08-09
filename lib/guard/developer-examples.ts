/**
 * Reviewed developer examples consumed by the Arc reference client. The
 * Workspace developer-example regression compares its rendered templates to
 * these exact bytes, so either public surface drifting fails the same gate.
 */
export const GUARD_SDK_EXAMPLE = `const intent = await ryntra.intents.create<{ id: string }>(input, {
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

if (evaluation.evidenceStatus !== "COMPLETE") return showMissing(evaluation);
if (evaluation.policyDecision === "BLOCKED_BY_RULE") return showBlockers(evaluation);

const authorization = await ryntra.authorize<{ id: string }>({
  intentId: intent.id,
  evaluationId: evaluation.id,
  fingerprint,
  subjectRef,
  method: "PARTNER_AUTHENTICATED",
}, { idempotencyKey: "authorize-order-001" });

// The wallet signs. This is the user's action, in their own wallet, and the
// application never holds the key that makes it.
const transactionHash = await partnerWallet.execute(transaction);

await ryntra.executions.record({
  intentId: intent.id,
  authorizationId: authorization.id,
  fingerprint,
  transactionHash,
}, { idempotencyKey: "record-order-001" });`;

export const GUARD_API_EXAMPLE = `POST /v1/intents/{intentId}/preflight
Authorization: Bearer <server-side key>
Idempotency-Key: <unique per request>
Content-Type: application/json

{
  "evidence": [{
    "schemaVersion": "1.0.0",
    "id": "evidence_quote_001",
    "provider": "partner-quote-service",
    "sourceRef": "quote:partner-order-001",
    "adapter": "partner-http",
    "adapterVersion": "1.0.0",
    "sourceType": "SWAP_QUOTE",
    "observedAt": "2026-08-08T12:00:00.000Z",
    "receivedAt": "2026-08-08T12:00:01.000Z",
    "validUntil": "2026-08-08T12:02:00.000Z",
    "confidence": "PROVIDER_REPORTED",
    "coverage": {
      "subjectRefs": ["partner-order-001"],
      "fields": [
        "quoteRef",
        "providerRef",
        "venueRef",
        "routeRef",
        "sellAssetRef",
        "buyAssetRef",
        "amountIn",
        "recipientAddress",
        "leverage",
        "expectedAmountOut",
        "minimumAmountOut",
        "feeAmount",
        "feeAssetRef",
        "totalDebit",
        "slippageBps"
      ],
      "limitations": ["Provider-reported quote"]
    },
    "availability": "AVAILABLE",
    "verificationStatus": "PROVIDER_REPORTED",
    "chainRef": "eip155:5042002",
    "blockRef": null,
    "transactionRef": null,
    "status": "VALID",
    "requestHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "responseHash": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "responseDigest": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "reason": null,
    "transformationVersion": "1.0.0",
    "fallbackUsed": false,
    "facts": {
      "quoteRef": "quote:partner-order-001",
      "providerRef": "partner-quote-service",
      "venueRef": "circle-app-kit",
      "routeRef": "circle-app-kit:swap",
      "sellAssetRef": "eip155:5042002/erc20:0x3600000000000000000000000000000000000000",
      "buyAssetRef": "eip155:5042002/erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a",
      "amountIn": "10.00",
      "recipientAddress": "0x1111111111111111111111111111111111111111",
      "leverage": null,
      "expectedAmountOut": "9.95",
      "minimumAmountOut": "9.93",
      "feeAmount": "0.02",
      "feeAssetRef": "eip155:5042002/erc20:0x3600000000000000000000000000000000000000",
      "totalDebit": "10.02",
      "slippageBps": "20"
    }
  }]
}

200 OK
{
  "data": {
    "evidenceStatus": "COMPLETE",
    "policyDecision": "ALLOWED_BY_POLICY",
    "authorizationStatus": "PENDING",
    "executionStatus": "NOT_STARTED",
    "reconciliationStatus": "NOT_RECONCILED",
    "expectedEffects": {
      "amountIn": "10.00",
      "amountOut": "9.95",
      "minimumAmountOut": "9.93",
      "feeAmount": "0.02",
      "totalDebit": "10.02"
    },
    "preflightHash": "0x3e172b6819145c5606ee227a89100627cd621b7871d8214daa8ba40db2655b88"
  }
}`;

export const GUARD_HEALTH_EXAMPLE = `curl -s https://<deployment>/health | jq

# Persistence, deployment shape, and whether state changes are accepted.
# A multi-instance deployment without a multi-writer store refuses every
# state change rather than losing it - reads stay available so the reason
# is visible.`;
