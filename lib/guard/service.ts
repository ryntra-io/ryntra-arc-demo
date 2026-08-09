import { z } from "zod";

import { hashCanonical as hashCanonicalValue } from "./canonical.ts";
import {
  DecisionSettlementReceiptSchema,
  EvidenceItemSchema,
  GuardPolicySchema,
  HumanAuthorizationSchema,
  PolicyResultSchema,
} from "./contracts.ts";
import { compareDecimalStrings, evaluateGuardReadiness } from "./kernel.ts";
import {
  createMemoryGuardStore,
  guardStoreLimitations,
  type GuardCollection,
  type GuardStore,
} from "./store.ts";

export type GuardErrorCode =
  | "VALIDATION_ERROR"
  | "CAPABILITY_UNAVAILABLE"
  | "TENANT_FORBIDDEN"
  | "EVIDENCE_INSUFFICIENT"
  | "POLICY_BLOCKED"
  | "HUMAN_AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_EXPIRED"
  | "EVALUATION_EXPIRED"
  | "FINGERPRINT_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "EXECUTION_NOT_CONFIRMED"
  | "RECOVERY_REQUIRED"
  | "RECONCILIATION_REQUIRED";

export class GuardError extends Error {
  readonly code: GuardErrorCode;
  readonly retryable: boolean;
  readonly requiredAction: string | null;

  constructor(
    code: GuardErrorCode,
    message: string,
    options: { retryable?: boolean; requiredAction?: string | null } = {},
  ) {
    super(message);
    this.name = "GuardError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.requiredAction = options.requiredAction ?? null;
  }
}

export function isGuardError(error: unknown, code?: GuardErrorCode): error is GuardError {
  return error instanceof GuardError && (!code || error.code === code);
}

export function hashCanonical(value: unknown): string {
  try {
    return hashCanonicalValue(value);
  } catch {
    throw new GuardError("VALIDATION_ERROR", "Value is not canonical JSON.");
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type Intent = {
  id: string;
  tenantId: string;
  schemaVersion: string;
  revision: number;
  subjectRef: string;
  walletAddress: string;
  chainRef: string;
  actionType: "SWAP" | "SEND" | "SPEND" | "BRIDGE";
  sellAssetRef: string;
  buyAssetRef: string;
  amount: string;
  leverage?: string | null;
  recipient: string;
  venueRef: string;
  routeRef: string;
  quoteRef: string | null;
  executionBindingKind?: "EVM_TRANSACTION" | "APP_KIT_REQUEST";
  target: string | null;
  calldataHash: string | null;
  nativeValue: string;
  adapterRequestHash?: string | null;
  productionCalldataBound?: boolean;
  expiresAt: string;
  policyRef: { id: string; version: number };
  [key: string]: unknown;
};

function intentCreateRequest(intent: Intent): Record<string, unknown> {
  /* The API assigns these fields after parsing the client body. They must not
     make an otherwise identical HTTP retry look like a different request. */
  return Object.fromEntries(
    Object.entries(intent).filter(
      ([key]) => key !== "id" && key !== "createdAt" && key !== "idempotencyKey",
    ),
  );
}

type QuoteEvidence = {
  id: string;
  sourceType: string;
  responseHash: string;
  responseDigest?: string;
  observedAt: string;
  validUntil: string;
  facts: {
    quoteRef: string;
    routeRef: string;
    amountIn: string;
    expectedAmountOut: string;
    minimumAmountOut: string;
    feeAmount: string;
    feeAssetRef: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const StoredFinancialPlanEvidenceSchema = EvidenceItemSchema.and(
  z.object({
    facts: z
      .object({
        quoteRef: z.string().min(1).max(128),
        routeRef: z.string().min(1).max(256),
        amountIn: z.string().min(1).max(128),
        expectedAmountOut: z.string().min(1).max(128),
        minimumAmountOut: z.string().min(1).max(128),
        feeAmount: z.string().min(1).max(128),
        feeAssetRef: z.string().min(1).max(256),
      })
      .passthrough(),
  }),
);

const STORED_HEX_HASH = /^0x[0-9a-fA-F]{64}$/;
const storedTimestamp = z.string().datetime({ offset: true });
const StoredExpectedEffectsSchema = z
  .object({
    amountIn: z.string().min(1).max(128),
    amountOut: z.string().min(1).max(128),
    minimumAmountOut: z.string().min(1).max(128),
    feeAmount: z.string().min(1).max(128),
    totalDebit: z.string().min(1).max(128),
  })
  .strict();
const StoredEvaluationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: z.string().min(3).max(128),
    tenantId: z.string().min(3).max(128),
    intentId: z.string().min(3).max(128),
    intentRevision: z.number().int().positive(),
    intentHash: z.string().regex(STORED_HEX_HASH),
    evidenceRoot: z.string().regex(STORED_HEX_HASH),
    evidenceRefs: z.array(z.string().min(3).max(128)).max(256),
    policyRef: z
      .object({
        id: z.string().min(1).max(128),
        version: z.number().int().positive(),
      })
      .strict(),
    policyVersion: z.number().int().positive(),
    policyDigest: z.string().regex(STORED_HEX_HASH),
    policyHash: z.string().regex(STORED_HEX_HASH),
    policyResult: PolicyResultSchema,
    createdAt: storedTimestamp,
    expiresAt: storedTimestamp,
    outcome: z.enum([
      "ALLOWED_BY_POLICY",
      "REVIEW_REQUIRED",
      "BLOCKED_BY_RULE",
      "INSUFFICIENT_EVIDENCE",
      "UNSUPPORTED",
      "EXPIRED",
    ]),
    policyDecision: z.enum([
      "ALLOWED_BY_POLICY",
      "REVIEW_REQUIRED",
      "BLOCKED_BY_RULE",
      "INSUFFICIENT_EVIDENCE",
      "UNSUPPORTED",
      "EXPIRED",
    ]),
    dataStatus: z.enum(["COMPLETE", "PARTIAL", "INSUFFICIENT", "CONFLICTING", "UNAVAILABLE"]),
    evidenceStatus: z.enum(["COMPLETE", "PARTIAL", "INSUFFICIENT", "CONFLICTING", "UNAVAILABLE"]),
    policyStatus: z.enum(["PASS", "WARN", "BLOCK", "NOT_EVALUATED"]),
    authorizationStatus: z.enum([
      "NOT_REQUIRED",
      "PENDING",
      "APPROVED",
      "REJECTED",
      "EXPIRED",
      "REVOKED",
    ]),
    executionStatus: z.enum([
      "NOT_STARTED",
      "SUBMITTED",
      "SOURCE_CONFIRMED",
      "IN_TRANSIT",
      "DESTINATION_PENDING",
      "CONFIRMED",
      "FAILED",
      "RECOVERY_REQUIRED",
      "RECONCILIATION_REQUIRED",
      "CANCELLED",
    ]),
    blockers: z.array(z.string().min(1).max(256)).max(128),
    missingEvidence: z.array(z.string().min(1).max(256)).max(128),
    evidenceSummary: z
      .array(
        z
          .object({
            id: z.string().min(3).max(128),
            provider: z.string().min(1).max(128),
            sourceRef: z.string().min(1).max(512),
            status: z.enum([
              "VALID",
              "STALE",
              "MISSING",
              "CONFLICTING",
              "UNAVAILABLE",
              "UNSUPPORTED",
            ]),
            availability: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE", "UNSUPPORTED"]),
            verificationStatus: z.string().min(1).max(128),
            fallbackUsed: z.boolean(),
          })
          .strict(),
      )
      .max(64)
      .optional(),
    expectedEffects: StoredExpectedEffectsSchema.nullable(),
    actualEffects: z.null(),
    reconciliationStatus: z.literal("NOT_RECONCILED"),
    preflightHash: z.string().regex(STORED_HEX_HASH),
    _idempotencyRequestHash: z.string().regex(STORED_HEX_HASH),
    _evidence: z.array(EvidenceItemSchema).min(1).max(64),
    _policy: GuardPolicySchema,
    _integrity: z
      .object({
        algorithm: z.literal("SHA-256"),
        hash: z.string().regex(STORED_HEX_HASH),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.outcome !== value.policyDecision ||
      value.outcome !== value.policyResult.decision ||
      value.policyStatus !== value.policyResult.status ||
      value.dataStatus !== value.evidenceStatus ||
      value.policyRef.id !== value._policy.id ||
      value.policyRef.version !== value._policy.version ||
      value.policyVersion !== value._policy.version ||
      value.policyResult.policyVersion !== value._policy.version ||
      value.policyResult.policyRef.id !== value._policy.id ||
      value.policyResult.policyRef.version !== value._policy.version ||
      value.policyDigest !== value.policyHash ||
      value.policyDigest !== hashCanonicalValue(value._policy) ||
      value.policyResult.policyDigest !== value.policyDigest ||
      value.evidenceRoot !== hashCanonicalValue(value._evidence) ||
      value.policyResult.evidenceRoot !== value.evidenceRoot ||
      value.policyResult.intentId !== value.intentId ||
      value.policyResult.intentRevision !== value.intentRevision ||
      value.policyResult.evidenceRefs.length !== value.evidenceRefs.length ||
      value.policyResult.evidenceRefs.some((entry, index) => entry !== value.evidenceRefs[index]) ||
      value._evidence.length !== value.evidenceRefs.length ||
      value._evidence.some((entry, index) => entry.id !== value.evidenceRefs[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored evaluation bindings are inconsistent.",
      });
    }
  });

type StoredEvaluation = z.output<typeof StoredEvaluationSchema>;

type StoredAuthorization = z.output<typeof HumanAuthorizationSchema> & {
  _idempotencyRequestHash: string;
  _integrity: {
    algorithm: "SHA-256";
    hash: string;
  };
};

function sealStoredEvaluation<T extends Record<string, unknown>>(payload: T) {
  return {
    ...payload,
    _integrity: {
      algorithm: "SHA-256" as const,
      hash: hashCanonicalValue(payload),
    },
  };
}

function validatedStoredEvaluationOrThrow(value: unknown): StoredEvaluation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuardError("RECOVERY_REQUIRED", "Stored evaluation is malformed.", {
      requiredAction: "CREATE_NEW_EVALUATION",
    });
  }
  const { _integrity, ...payload } = value as Record<string, unknown>;
  let integrityMatches = false;
  try {
    integrityMatches =
      Boolean(_integrity) &&
      typeof _integrity === "object" &&
      !Array.isArray(_integrity) &&
      (_integrity as Record<string, unknown>).algorithm === "SHA-256" &&
      (_integrity as Record<string, unknown>).hash === hashCanonicalValue(payload);
  } catch {
    integrityMatches = false;
  }
  const parsed = StoredEvaluationSchema.safeParse(value);
  if (!integrityMatches || !parsed.success) {
    throw new GuardError(
      "RECOVERY_REQUIRED",
      `Stored evaluation failed ${parsed.success ? "integrity" : "schema"} validation.`,
      { requiredAction: "CREATE_NEW_EVALUATION" },
    );
  }
  return parsed.data;
}

function sealStoredAuthorization<T extends Record<string, unknown>>(payload: T) {
  return {
    ...payload,
    _integrity: {
      algorithm: "SHA-256" as const,
      hash: hashCanonicalValue(payload),
    },
  };
}

function validatedStoredAuthorizationOrThrow(value: unknown): StoredAuthorization {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuardError(
      "RECOVERY_REQUIRED",
      "Stored authorization failed schema or integrity validation.",
      { requiredAction: "CREATE_NEW_EVALUATION" },
    );
  }
  const {
    _integrity,
    _idempotencyRequestHash,
    ...publicAuthorization
  } = value as Record<string, unknown>;
  const integrityValid =
    _integrity !== null &&
    typeof _integrity === "object" &&
    !Array.isArray(_integrity) &&
    (_integrity as Record<string, unknown>).algorithm === "SHA-256" &&
    typeof (_integrity as Record<string, unknown>).hash === "string" &&
    (_integrity as Record<string, unknown>).hash ===
      hashCanonicalValue({ ...publicAuthorization, _idempotencyRequestHash });
  const parsed = HumanAuthorizationSchema.safeParse(publicAuthorization);
  if (
    !integrityValid ||
    !parsed.success ||
    typeof _idempotencyRequestHash !== "string" ||
    !STORED_HEX_HASH.test(_idempotencyRequestHash)
  ) {
    throw new GuardError(
      "RECOVERY_REQUIRED",
      "Stored authorization failed schema or integrity validation.",
      { requiredAction: "CREATE_NEW_EVALUATION" },
    );
  }
  return {
    ...parsed.data,
    _idempotencyRequestHash,
    _integrity: _integrity as StoredAuthorization["_integrity"],
  };
}

function assertEvaluationIntentHashOrThrow(
  evaluation: StoredEvaluation,
  storedIntent: Intent,
): void {
  if (evaluation.intentHash !== hashCanonicalValue(storedIntent)) {
    throw new GuardError(
      "RECOVERY_REQUIRED",
      "Stored evaluation no longer matches the persisted intent bytes.",
      { requiredAction: "CREATE_NEW_EVALUATION" },
    );
  }
}

function effectivePreflightExpiry({
  intentExpiresAt,
  quote,
  policyRules,
}: {
  intentExpiresAt: string;
  quote: QuoteEvidence | undefined;
  policyRules: unknown[];
}): string | null {
  if (!quote) return null;
  const ageRule = policyRules.find(
    (rule): rule is { type: "MAX_QUOTE_AGE_SECONDS"; value: number } =>
      Boolean(
        rule &&
          typeof rule === "object" &&
          (rule as Record<string, unknown>).type === "MAX_QUOTE_AGE_SECONDS" &&
          Number.isInteger((rule as Record<string, unknown>).value) &&
          Number((rule as Record<string, unknown>).value) > 0,
      ),
  );
  if (!ageRule) return null;
  const intentExpiry = Date.parse(intentExpiresAt);
  const quoteExpiry = Date.parse(quote.validUntil);
  const observedAt = Date.parse(quote.observedAt);
  if (![intentExpiry, quoteExpiry, observedAt].every(Number.isFinite)) return null;
  const freshnessExpiry = observedAt + ageRule.value * 1_000;
  if (!Number.isFinite(freshnessExpiry)) return null;
  return new Date(Math.min(intentExpiry, quoteExpiry, freshnessExpiry)).toISOString();
}

function financialPlanEvidence(
  evidence: readonly unknown[],
  actionType: Intent["actionType"],
): QuoteEvidence | undefined {
  const requiredSourceType =
    actionType === "SEND" ? "TRANSFER_PLAN" : actionType === "SWAP" ? "SWAP_QUOTE" : null;
  if (!requiredSourceType) return undefined;
  const relevant = evidence.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          (entry as Record<string, unknown>).sourceType === requiredSourceType,
      ),
  );
  if (relevant.length !== 1) return undefined;
  const parsed = StoredFinancialPlanEvidenceSchema.safeParse(relevant[0]);
  return parsed.success ? (parsed.data as QuoteEvidence) : undefined;
}

function expectedEffectsFromEvidence(evidence: QuoteEvidence | undefined) {
  if (!evidence) return null;
  const { amountIn, expectedAmountOut, minimumAmountOut, feeAmount, totalDebit } = evidence.facts;
  if (
    typeof amountIn !== "string" ||
    typeof expectedAmountOut !== "string" ||
    typeof minimumAmountOut !== "string" ||
    typeof feeAmount !== "string" ||
    typeof totalDebit !== "string"
  ) {
    return null;
  }
  return { amountIn, amountOut: expectedAmountOut, minimumAmountOut, feeAmount, totalDebit };
}

export type ExecutionFingerprint = {
  schemaVersion: "1.0.0";
  intentId: string;
  intentRevision: number;
  chainRef: string;
  walletAddress: string;
  bindingKind: "EVM_TRANSACTION" | "APP_KIT_REQUEST";
  target: string | null;
  calldataHash: string | null;
  nativeValue: string;
  adapterRequestHash: string | null;
  productionCalldataBound: boolean;
  sellAssetRef: string;
  buyAssetRef: string;
  amount: string;
  leverage: string | null;
  recipient: string;
  venueRef: string;
  routeRef: string;
  quoteHash: string;
  maxFee: string;
  minimumOutput: string;
  expiresAt: string;
};

export function buildExecutionFingerprint({
  intent,
  quote,
}: {
  intent: Intent;
  quote: QuoteEvidence;
}): ExecutionFingerprint {
  const bindingKind = intent.executionBindingKind ?? "EVM_TRANSACTION";
  if (bindingKind === "EVM_TRANSACTION" && (!intent.target || !intent.calldataHash)) {
    throw new GuardError(
      "VALIDATION_ERROR",
      "EVM transaction binding requires target and calldata hash.",
    );
  }
  if (
    bindingKind === "APP_KIT_REQUEST" &&
    (!intent.adapterRequestHash || intent.productionCalldataBound !== false)
  ) {
    throw new GuardError(
      "VALIDATION_ERROR",
      "App Kit request binding requires an explicit request hash and non-production limitation.",
    );
  }
  return {
    schemaVersion: "1.0.0",
    intentId: intent.id,
    intentRevision: intent.revision,
    chainRef: intent.chainRef,
    walletAddress: intent.walletAddress.toLowerCase(),
    bindingKind,
    target: bindingKind === "EVM_TRANSACTION" ? intent.target!.toLowerCase() : null,
    calldataHash: bindingKind === "EVM_TRANSACTION" ? intent.calldataHash!.toLowerCase() : null,
    nativeValue: intent.nativeValue,
    adapterRequestHash:
      bindingKind === "APP_KIT_REQUEST" ? intent.adapterRequestHash!.toLowerCase() : null,
    productionCalldataBound: bindingKind === "EVM_TRANSACTION",
    sellAssetRef: intent.sellAssetRef.toLowerCase(),
    buyAssetRef: intent.buyAssetRef.toLowerCase(),
    amount: intent.amount,
    leverage: intent.leverage ?? null,
    recipient: intent.recipient.toLowerCase(),
    venueRef: intent.venueRef,
    routeRef: intent.routeRef,
    quoteHash: (quote.responseDigest ?? quote.responseHash).toLowerCase(),
    maxFee: quote.facts.feeAmount,
    minimumOutput: quote.facts.minimumAmountOut,
    expiresAt:
      Date.parse(intent.expiresAt) < Date.parse(quote.validUntil)
        ? intent.expiresAt
        : quote.validUntil,
  };
}

type ServiceOptions = {
  now: () => string;
  createId: (prefix: string) => string;
  /**
   * Persistence adapter. Defaults to per-process memory so unit tests stay
   * isolated; the runtime supplies the configured adapter and refuses writes
   * when its durability is weaker than the deployment requires.
   */
  store?: GuardStore;
};

type IdempotencyRecord = {
  requestHash: string;
  /** Diagnostic lease origin for crash recovery and operator evidence. */
  startedAt?: string;
  /** Absent while `inFlight` — the response does not exist yet. */
  response?: unknown;
  /** True between claiming the key and storing the result. */
  inFlight?: boolean;
};

export function createGuardService(options: ServiceOptions) {
  const store = options.store ?? createMemoryGuardStore();
  const intents = store.collection<Intent>("intents");
  const evaluations = store.collection<Record<string, unknown>>("evaluations");
  const authorizations = store.collection<Record<string, unknown>>("authorizations");
  const executions = store.collection<Record<string, unknown>>("executions");
  const receipts = store.collection<Record<string, unknown>>("receipts");
  const idempotency = store.collection<IdempotencyRecord>("idempotency");
  const transactionIndex = store.collection<string>("transactionIndex");
  /* Reported verbatim by GET status so a caller can never read a durable
     lifecycle into an ephemeral one. It follows the adapter, not a constant. */
  const storeLimitations = guardStoreLimitations(store);

  const objectKey = (tenantId: string, id: string) => `${tenantId}:${id}`;

  function publicEvaluation(value: Record<string, unknown>) {
    return clone(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => !key.startsWith("_")),
      ),
    );
  }

  async function requireTenantObject<T>(
    collection: GuardCollection<T>,
    tenantId: string,
    id: string,
  ): Promise<T> {
    const result = await collection.get(objectKey(tenantId, id));
    if (!result) {
      throw new GuardError("TENANT_FORBIDDEN", "Object is unavailable to this tenant.");
    }
    return result;
  }

  async function requireCurrentAuthorizationBinding({
    tenantId,
    intentId,
    authorizationId,
  }: {
    tenantId: string;
    intentId: string;
    authorizationId: string | null;
  }) {
    const storedIntent = await requireTenantObject(intents, tenantId, intentId);
    if (!authorizationId) {
      throw new GuardError(
        "HUMAN_AUTHORIZATION_REQUIRED",
        "Execution requires explicit human authorization.",
      );
    }
    const authorization = validatedStoredAuthorizationOrThrow(
      await requireTenantObject(
        authorizations,
        tenantId,
        authorizationId,
      ),
    );
    if (
      authorization.id !== authorizationId ||
      authorization.tenantId !== tenantId ||
      authorization.intentId !== intentId ||
      authorization.intentRevision !== storedIntent.revision ||
      authorization.subjectRef !== storedIntent.subjectRef ||
      authorization.decision !== "APPROVED"
    ) {
      throw new GuardError("FINGERPRINT_MISMATCH", "Authorization is not bound to this intent.");
    }
    const evaluation = validatedStoredEvaluationOrThrow(
      await requireTenantObject(
        evaluations,
        tenantId,
        String(authorization.evaluationId),
      ),
    );
    if (
      evaluation.id !== authorization.evaluationId ||
      evaluation.intentId !== intentId ||
      evaluation.intentRevision !== storedIntent.revision ||
      authorization.intentHash !== evaluation.intentHash ||
      authorization.evidenceRoot !== evaluation.evidenceRoot ||
      authorization.policyHash !== evaluation.policyHash ||
      authorization.policyVersion !== evaluation.policyVersion ||
      authorization.policyDigest !== evaluation.policyDigest ||
      authorization.preflightHash !== evaluation.preflightHash
    ) {
      throw new GuardError(
        "RECOVERY_REQUIRED",
        "Authorization and evaluation bindings are inconsistent.",
        { requiredAction: "CREATE_NEW_EVALUATION" },
      );
    }
    assertEvaluationIntentHashOrThrow(evaluation, storedIntent);
    const quote = financialPlanEvidence(evaluation._evidence, storedIntent.actionType);
    if (!quote) {
      throw new GuardError(
        "RECOVERY_REQUIRED",
        "Stored evaluation financial-plan evidence failed schema validation.",
        { requiredAction: "CREATE_NEW_EVALUATION" },
      );
    }
    const expectedFingerprint = buildExecutionFingerprint({ intent: storedIntent, quote });
    const expectedFingerprintHash = hashCanonical(expectedFingerprint);
    if (authorization.executionFingerprintHash !== expectedFingerprintHash) {
      throw new GuardError(
        "RECOVERY_REQUIRED",
        "Stored authorization fingerprint no longer matches its sealed evaluation.",
        { requiredAction: "CREATE_NEW_EVALUATION" },
      );
    }
    return { storedIntent, authorization, evaluation, expectedFingerprintHash };
  }

  /**
   * Run `create` at most once per idempotency key, across every instance.
   *
   * The key is claimed atomically *before* the work runs. Claiming afterwards
   * would let two instances that both saw a free key each execute `create` —
   * which for this service means two intents, or worse, two recorded
   * broadcasts of the same authorization. Whoever loses the claim either
   * replays the winner's stored response or, if the winner has not finished
   * yet, is told to retry rather than being handed a half-built answer.
   */
  async function withIdempotency<T extends Record<string, unknown>>(
    tenantId: string,
    operation: string,
    key: string,
    request: unknown,
    create: () => Promise<T>,
    recover?: () => Promise<T | null>,
  ): Promise<T & { idempotentReplay?: boolean }> {
    if (!key) throw new GuardError("VALIDATION_ERROR", "Idempotency-Key is required.");
    const scope = `${tenantId}:${operation}:${key}`;
    const requestHash = hashCanonical(request);

    const claimed = await idempotency.insertIfAbsent(scope, {
      requestHash,
      startedAt: options.now(),
      inFlight: true,
    });
    if (!claimed) {
      const existing = await idempotency.get(scope);
      if (!existing) {
        /* The record vanished between the failed claim and this read. Refusing
           is the only safe answer: re-running could duplicate the effect the
           key exists to prevent. */
        throw new GuardError("IDEMPOTENCY_CONFLICT", "The idempotency key is in an unknown state.", {
          retryable: true,
        });
      }
      if (existing.requestHash !== requestHash) {
        throw new GuardError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used with a different request.",
        );
      }
      const inFlight = existing.inFlight === true;
      const hasCompletedResponse =
        existing.response !== null &&
        typeof existing.response === "object" &&
        !Array.isArray(existing.response);
      if (
        (existing.inFlight !== undefined && typeof existing.inFlight !== "boolean") ||
        inFlight === hasCompletedResponse
      ) {
        throw new GuardError(
          "RECOVERY_REQUIRED",
          "The idempotency record is malformed and cannot be replayed safely.",
          { requiredAction: "RECOVER_IDEMPOTENCY_RECORD" },
        );
      }
      if (inFlight) {
        const recovered = recover ? await recover() : null;
        if (recovered) {
          /* The mutation committed before the worker disappeared. Persist its
             deterministic result when possible, but return it even if this
             bookkeeping write is temporarily unavailable: re-running a money
             effect would be less safe than another recovery read. */
          try {
            await idempotency.set(scope, { requestHash, response: clone(recovered) });
          } catch {
            // The durable effect remains recoverable on the next retry.
          }
          return { ...clone(recovered), idempotentReplay: true };
        }
        throw new GuardError(
          "IDEMPOTENCY_CONFLICT",
          "The same request has an unresolved in-flight claim and no committed result was found.",
          { retryable: false, requiredAction: "RECOVER_IDEMPOTENT_OPERATION" },
        );
      }
      const completedResponse = clone(existing.response) as T;
      if (recover) {
        const recovered = await recover();
        if (!recovered || hashCanonical(recovered) !== hashCanonical(completedResponse)) {
          throw new GuardError(
            "RECOVERY_REQUIRED",
            "The completed idempotency response does not match the durable operation result.",
            { requiredAction: "RECOVER_IDEMPOTENT_OPERATION" },
          );
        }
        return { ...clone(recovered), idempotentReplay: true };
      }
      if (Object.keys(completedResponse).length === 0) {
        throw new GuardError(
          "RECOVERY_REQUIRED",
          "The completed idempotency response is empty and cannot be replayed safely.",
          { requiredAction: "RECOVER_IDEMPOTENCY_RECORD" },
        );
      }
      return { ...completedResponse, idempotentReplay: true };
    }

    try {
      const response = await create();
      await idempotency.set(scope, { requestHash, response: clone(response) });
      return clone(response);
    } catch (error) {
      const recovered = recover ? await recover() : null;
      if (recovered) {
        try {
          await idempotency.set(scope, { requestHash, response: clone(recovered) });
        } catch {
          // Keep the in-flight claim: the committed effect remains recoverable.
        }
        return clone(recovered);
      }
      /* Release the claim so a corrected request can be retried. Any effect
         `create` managed to write before failing keeps its own protection —
         intent ids and transaction hashes are claimed atomically too, so a
         retry surfaces the real conflict instead of silently duplicating. */
      await idempotency.delete(scope);
      throw error;
    }
  }

  function createIntent({
    tenantId,
    intent,
    idempotencyKey,
  }: {
    tenantId: string;
    intent: Intent;
    idempotencyKey: string;
  }) {
    const intentKey = objectKey(tenantId, intent.id);
    const createRequest = intentCreateRequest(intent);
    const createRequestHash = hashCanonical(createRequest);
    return withIdempotency(
      tenantId,
      "intent.create",
      idempotencyKey,
      createRequest,
      async () => {
        if (intent.tenantId !== tenantId) {
          throw new GuardError("TENANT_FORBIDDEN", "Intent tenant does not match authentication.");
        }
        const stored = clone(intent);
        /* Claimed atomically rather than checked then written: two instances
           creating the same intent id must not both believe they succeeded. */
        if (!(await intents.insertIfAbsent(intentKey, stored))) {
          throw new GuardError("IDEMPOTENCY_CONFLICT", "Intent ID already exists.");
        }
        return stored;
      },
      async () => {
        for (const existing of await intents.valuesWithPrefix(`${tenantId}:`)) {
          if (
            existing.tenantId === tenantId &&
            existing.idempotencyKey === intent.idempotencyKey &&
            hashCanonical(intentCreateRequest(existing)) === createRequestHash
          ) {
            return clone(existing);
          }
        }
        return null;
      },
    );
  }

  function preflight({
    tenantId,
    intentId,
    evidence,
    policy,
    idempotencyKey,
  }: {
    tenantId: string;
    intentId: string;
    evidence: QuoteEvidence[];
    policy: { id: string; version: number; rules: unknown[]; [key: string]: unknown };
    idempotencyKey: string;
  }) {
    const preflightRequest = { intentId, evidence, policy };
    const preflightRequestHash = hashCanonical(preflightRequest);
    return withIdempotency(
      tenantId,
      "intent.preflight",
      idempotencyKey,
      preflightRequest,
      async () => {
        const storedIntent = await requireTenantObject(intents, tenantId, intentId);
        if (
          storedIntent.policyRef.id !== policy.id ||
          storedIntent.policyRef.version !== policy.version
        ) {
          throw new GuardError(
            "FINGERPRINT_MISMATCH",
            "Policy does not match the policy reference bound to the intent.",
          );
        }
        const createdAt = options.now();
        const readiness = evaluateGuardReadiness({
          intent: storedIntent,
          evidence,
          policy,
          now: createdAt,
        } as unknown as Parameters<typeof evaluateGuardReadiness>[0]);
        const quote = financialPlanEvidence(evidence, storedIntent.actionType);
        const expectedEffects = expectedEffectsFromEvidence(quote);
        const policyDigest = hashCanonical(policy);
        const intentHash = hashCanonical(storedIntent);
        const evidenceRoot = hashCanonical(evidence);
        const expiresAt =
          effectivePreflightExpiry({
            intentExpiresAt: storedIntent.expiresAt,
            quote,
            policyRules: policy.rules,
          }) ?? createdAt;
        const policyResult = {
          schemaVersion: "1.0.0",
          id: options.createId("policy-result"),
          intentId,
          intentRevision: storedIntent.revision,
          policyRef: { id: policy.id, version: policy.version },
          policyVersion: policy.version,
          policyDigest,
          evidenceRoot,
          evidenceRefs: evidence.map((entry) => entry.id),
          decision: readiness.policyDecision,
          status: readiness.policyStatus,
          blockers: readiness.blockers,
          warnings: readiness.policyStatus === "WARN" ? ["POLICY_REVIEW_REQUIRED"] : [],
          evaluatedAt: createdAt,
        };
        const evaluationWithoutPreflightHash = {
          schemaVersion: "1.0.0",
          id: options.createId("eval"),
          tenantId,
          intentId,
          intentRevision: storedIntent.revision,
          intentHash,
          evidenceRoot,
          evidenceRefs: evidence.map((entry) => entry.id),
          policyRef: { id: policy.id, version: policy.version },
          policyVersion: policy.version,
          policyDigest,
          policyHash: policyDigest,
          policyResult,
          createdAt,
          expiresAt,
          ...readiness,
          expectedEffects,
          actualEffects: null,
          reconciliationStatus: "NOT_RECONCILED",
        };
        const preflightHash = hashCanonical({
          schemaVersion: evaluationWithoutPreflightHash.schemaVersion,
          tenantId,
          intentId,
          intentRevision: storedIntent.revision,
          intentHash,
          evidenceRoot,
          evidenceRefs: evaluationWithoutPreflightHash.evidenceRefs,
          policyVersion: policy.version,
          policyDigest,
          evidenceStatus: readiness.evidenceStatus,
          policyDecision: readiness.policyDecision,
          expectedEffects,
          createdAt,
          expiresAt,
        });
        const evaluation = sealStoredEvaluation({
          ...evaluationWithoutPreflightHash,
          preflightHash,
          _idempotencyRequestHash: preflightRequestHash,
          _evidence: clone(evidence),
          _policy: clone(policy),
        });
        await evaluations.set(objectKey(tenantId, evaluation.id), evaluation);
        return publicEvaluation(evaluation);
      },
      async () => {
        for (const stored of await evaluations.valuesWithPrefix(`${tenantId}:`)) {
          if (
            stored.tenantId === tenantId &&
            stored.intentId === intentId &&
            stored._idempotencyRequestHash === preflightRequestHash
          ) {
            /* Idempotent recovery returns evidence of a prior run, and a row is
               only evidence while it still validates. The seal, the schema and
               the current intent bytes are re-checked exactly as the authorize
               path re-checks them; a matching request hash over a corrupt or
               drifted row fails closed as RECOVERY_REQUIRED rather than being
               replayed as a good evaluation. */
            const evaluation = validatedStoredEvaluationOrThrow(stored);
            const storedIntent = await requireTenantObject(intents, tenantId, intentId);
            assertEvaluationIntentHashOrThrow(evaluation, storedIntent);
            return publicEvaluation(evaluation);
          }
        }
        return null;
      },
    );
  }

  function authorize({
    tenantId,
    intentId,
    evaluationId,
    fingerprint,
    subjectRef,
    method,
    idempotencyKey,
  }: {
    tenantId: string;
    intentId: string;
    evaluationId: string;
    fingerprint: ExecutionFingerprint;
    subjectRef: string;
    method: "PARTNER_AUTHENTICATED" | "EIP712";
    idempotencyKey: string;
  }) {
    const authorizationRequest = { intentId, evaluationId, fingerprint, subjectRef, method };
    const authorizationRequestHash = hashCanonical(authorizationRequest);
    return withIdempotency(
      tenantId,
      "intent.authorize",
      idempotencyKey,
      authorizationRequest,
      async () => {
        const storedIntent = await requireTenantObject(intents, tenantId, intentId);
        const authorizationCreatedAt = options.now();
        const authorizationCreatedAtMs = Date.parse(authorizationCreatedAt);
        if (method === "EIP712") {
          throw new GuardError(
            "CAPABILITY_UNAVAILABLE",
            "EIP-712 authorization is unavailable until typed-data signature verification is implemented.",
            { requiredAction: "USE_PARTNER_AUTHENTICATED_AUTHORIZATION" },
          );
        }
        if (subjectRef !== storedIntent.subjectRef) {
          throw new GuardError(
            "FINGERPRINT_MISMATCH",
            "Authorization subject does not match the subject bound to the intent.",
          );
        }
        const evaluation = validatedStoredEvaluationOrThrow(
          await requireTenantObject(evaluations, tenantId, evaluationId),
        );
        if (
          evaluation.intentId !== intentId ||
          evaluation.intentRevision !== storedIntent.revision
        ) {
          throw new GuardError("FINGERPRINT_MISMATCH", "Evaluation is not bound to this intent revision.");
        }
        assertEvaluationIntentHashOrThrow(evaluation, storedIntent);
        const evaluationExpiresAt = Date.parse(String(evaluation.expiresAt));
        if (
          !Number.isFinite(authorizationCreatedAtMs) ||
          !Number.isFinite(evaluationExpiresAt) ||
          evaluationExpiresAt <= authorizationCreatedAtMs
        ) {
          throw new GuardError("EVALUATION_EXPIRED", "The readiness evaluation has expired.", {
            retryable: true,
            requiredAction: "CREATE_NEW_EVALUATION",
          });
        }
        if (
          evaluation.outcome !== "ALLOWED_BY_POLICY" ||
          evaluation.policyDecision !== "ALLOWED_BY_POLICY" ||
          evaluation.policyStatus !== "PASS" ||
          evaluation.dataStatus !== "COMPLETE" ||
          evaluation.evidenceStatus !== "COMPLETE" ||
          evaluation.policyResult.decision !== "ALLOWED_BY_POLICY" ||
          evaluation.policyResult.status !== "PASS" ||
          evaluation.blockers.length !== 0 ||
          evaluation.missingEvidence.length !== 0 ||
          evaluation.expectedEffects === null
        ) {
          throw new GuardError("POLICY_BLOCKED", "Evaluation does not positively permit authorization.");
        }
        const evidence = evaluation._evidence;
        const quote = financialPlanEvidence(evidence, storedIntent.actionType);
        if (!quote) {
          throw new GuardError(
            "RECOVERY_REQUIRED",
            "Stored evaluation financial-plan evidence failed schema validation.",
            { requiredAction: "CREATE_NEW_EVALUATION" },
          );
        }
        const expected = buildExecutionFingerprint({ intent: storedIntent, quote });
        const fingerprintExpiresAt = Date.parse(expected.expiresAt);
        if (
          !Number.isFinite(fingerprintExpiresAt) ||
          fingerprintExpiresAt <= authorizationCreatedAtMs
        ) {
          throw new GuardError("AUTHORIZATION_EXPIRED", "Authorization window has already expired.", {
            retryable: true,
            requiredAction: "CREATE_NEW_EVALUATION",
          });
        }
        if (hashCanonical(expected) !== hashCanonical(fingerprint)) {
          throw new GuardError("FINGERPRINT_MISMATCH", "Authorization fingerprint does not match intent.");
        }
        const authorization = sealStoredAuthorization({
          schemaVersion: "1.0.0",
          id: options.createId("auth"),
          tenantId,
          intentId,
          intentRevision: storedIntent.revision,
          evaluationId,
          intentHash: evaluation.intentHash,
          evidenceRoot: evaluation.evidenceRoot,
          policyHash: evaluation.policyHash,
          policyVersion: evaluation.policyVersion,
          policyDigest: evaluation.policyDigest,
          preflightHash: evaluation.preflightHash,
          executionFingerprintHash: hashCanonical(fingerprint),
          materialWarningsShown: [],
          subjectRef,
          method,
          decision: "APPROVED",
          createdAt: authorizationCreatedAt,
          expiresAt: new Date(Math.min(fingerprintExpiresAt, evaluationExpiresAt)).toISOString(),
          signatureRef: null,
          _idempotencyRequestHash: authorizationRequestHash,
        });
        await authorizations.set(objectKey(tenantId, authorization.id), authorization);
        return publicEvaluation(authorization);
      },
      async () => {
        for (const authorization of await authorizations.valuesWithPrefix(`${tenantId}:`)) {
          if (
            authorization.tenantId === tenantId &&
            authorization.intentId === intentId &&
            authorization._idempotencyRequestHash === authorizationRequestHash &&
            typeof authorization.id === "string"
          ) {
            const binding = await requireCurrentAuthorizationBinding({
              tenantId,
              intentId,
              authorizationId: authorization.id,
            });
            if (
              binding.authorization.method !== method ||
              binding.expectedFingerprintHash !== hashCanonical(fingerprint)
            ) {
              throw new GuardError(
                "RECOVERY_REQUIRED",
                "Recovered authorization no longer matches its original request.",
                { requiredAction: "CREATE_NEW_EVALUATION" },
              );
            }
            return publicEvaluation(binding.authorization);
          }
        }
        return null;
      },
    );
  }

  function recordExecution({
    tenantId,
    intentId,
    authorizationId,
    fingerprint,
    transactionHash,
    idempotencyKey,
  }: {
    tenantId: string;
    intentId: string;
    authorizationId: string | null;
    fingerprint: ExecutionFingerprint;
    transactionHash: string;
    idempotencyKey: string;
  }) {
    const executionRequest = { intentId, authorizationId, fingerprint, transactionHash };
    const intentExecutionKey = objectKey(tenantId, intentId);
    const txKey = `${fingerprint.chainRef}:${transactionHash.toLowerCase()}`;
    const intentTransactionKey = `intent:${intentExecutionKey}`;
    const fingerprintHash = hashCanonical(fingerprint);
    const recoverExecution = async () => {
      const existing = await executions.get(intentExecutionKey);
      if (
        !existing ||
        existing.tenantId !== tenantId ||
        existing.intentId !== intentId ||
        existing.authorizationId !== authorizationId ||
        existing.executionFingerprintHash !== fingerprintHash ||
        existing.transactionHash !== transactionHash.toLowerCase()
      ) {
        return null;
      }
      const binding = await requireCurrentAuthorizationBinding({
        tenantId,
        intentId,
        authorizationId,
      });
      if (fingerprintHash !== binding.expectedFingerprintHash) {
        throw new GuardError("FINGERPRINT_MISMATCH", "Execution differs from authorization.");
      }
      const expectedBinding = objectKey(tenantId, intentId);
      let transactionBinding = await transactionIndex.get(txKey);
      let intentTransactionBinding = await transactionIndex.get(intentTransactionKey);
      if (!transactionBinding && !intentTransactionBinding) {
        if (
          await transactionIndex.insertAllIfAbsent([
            { key: txKey, value: expectedBinding },
            { key: intentTransactionKey, value: txKey },
          ])
        ) {
          transactionBinding = expectedBinding;
          intentTransactionBinding = txKey;
        } else {
          transactionBinding = await transactionIndex.get(txKey);
          intentTransactionBinding = await transactionIndex.get(intentTransactionKey);
        }
      } else if (!transactionBinding && intentTransactionBinding === txKey) {
        if (await transactionIndex.insertIfAbsent(txKey, expectedBinding)) {
          transactionBinding = expectedBinding;
        } else {
          transactionBinding = await transactionIndex.get(txKey);
        }
      } else if (!intentTransactionBinding && transactionBinding === expectedBinding) {
        if (await transactionIndex.insertIfAbsent(intentTransactionKey, txKey)) {
          intentTransactionBinding = txKey;
        } else {
          intentTransactionBinding = await transactionIndex.get(intentTransactionKey);
        }
      }
      return transactionBinding === expectedBinding && intentTransactionBinding === txKey
        ? clone(existing)
        : null;
    };
    return withIdempotency(
      tenantId,
      "intent.execute",
      idempotencyKey,
      executionRequest,
      async () => {
        const { storedIntent, authorization, expectedFingerprintHash } =
          await requireCurrentAuthorizationBinding({
            tenantId,
            intentId,
            authorizationId,
          });
        const submittedAt = options.now();
        const submittedAtMs = Date.parse(submittedAt);
        const authorizationExpiresAt = Date.parse(String(authorization.expiresAt));
        if (
          !Number.isFinite(submittedAtMs) ||
          !Number.isFinite(authorizationExpiresAt) ||
          authorizationExpiresAt <= submittedAtMs
        ) {
          throw new GuardError("AUTHORIZATION_EXPIRED", "Authorization has expired.", {
            retryable: true,
            requiredAction: "CREATE_NEW_EVALUATION",
          });
        }
        if (
          authorization.executionFingerprintHash !== fingerprintHash ||
          fingerprintHash !== expectedFingerprintHash
        ) {
          throw new GuardError("FINGERPRINT_MISMATCH", "Execution differs from authorization.");
        }
        if (
          fingerprint.bindingKind !== "EVM_TRANSACTION" ||
          fingerprint.productionCalldataBound !== true
        ) {
          throw new GuardError(
            "CAPABILITY_UNAVAILABLE",
            "Execution recording requires an exact production calldata binding.",
            { requiredAction: "USE_EXACT_CALLDATA_BOUND_EXECUTION" },
          );
        }
        const execution = {
          schemaVersion: "1.0.0",
          id: options.createId("exec"),
          tenantId,
          intentId,
          intentRevision: storedIntent.revision,
          authorizationId,
          bindingKind: fingerprint.bindingKind,
          productionCalldataBound: fingerprint.productionCalldataBound,
          executionFingerprintHash: fingerprintHash,
          transactionHash: transactionHash.toLowerCase(),
          status: "SUBMITTED",
          reconciliationStatus: "NOT_RECONCILED",
          submittedAt,
          confirmedAt: null,
          actualOutcome: null,
        };
        /* The per-intent execution is claimed first. Reconciliation separately
           requires the global tx owner, so this provisional row cannot become
           a receipt before the atomic pair below commits. If the process dies
           at this boundary, idempotent recovery can finish the pair. */
        if (!(await executions.insertIfAbsent(intentExecutionKey, execution))) {
          throw new GuardError(
            "IDEMPOTENCY_CONFLICT",
            "This intent already has a recorded execution; a second broadcast is rejected.",
          );
        }
        if (
          !(await transactionIndex.insertAllIfAbsent([
            { key: txKey, value: objectKey(tenantId, intentId) },
            { key: intentTransactionKey, value: txKey },
          ]))
        ) {
          await executions.delete(intentExecutionKey);
          throw new GuardError("IDEMPOTENCY_CONFLICT", "Transaction was already recorded.");
        }
        return execution;
      },
      recoverExecution,
    );
  }

  function reconcileExecution({
    tenantId,
    intentId,
    transactionHash,
    observedState,
    actualOutcome,
    reconciliationEvidence,
    idempotencyKey,
  }: {
    tenantId: string;
    intentId: string;
    transactionHash: string;
    observedState: "RPC_UNCERTAIN_AFTER_BROADCAST" | "CONFIRMED";
    actualOutcome?: {
      amountIn: string;
      amountOut: string;
      feeAmount: string;
      explorerUrl: string;
    };
    reconciliationEvidence?: {
      provider: string;
      sourceRef: string;
      verificationStatus: "PROVIDER_REPORTED" | "ONCHAIN_VERIFIED";
      observedAt: string;
      responseDigest: string;
    };
    idempotencyKey?: string;
  }) {
    const finalizationKey = objectKey(tenantId, intentId);
    const reconciliationRequest = {
      intentId,
      transactionHash,
      observedState,
      actualOutcome,
      reconciliationEvidence,
    };
    const recoverReconciliation = async () => {
      const execution = await executions.get(finalizationKey);
      if (!execution || execution.transactionHash !== transactionHash.toLowerCase()) return null;
      const binding = await requireCurrentAuthorizationBinding({
        tenantId,
        intentId,
        authorizationId:
          typeof execution.authorizationId === "string" ? execution.authorizationId : null,
      });
      if (
        execution.intentId !== intentId ||
        execution.intentRevision !== binding.storedIntent.revision ||
        execution.authorizationId !== binding.authorization.id ||
        execution.executionFingerprintHash !== binding.expectedFingerprintHash
      ) {
        throw new GuardError(
          "RECOVERY_REQUIRED",
          "Stored execution no longer matches its authorization and intent bindings.",
          { requiredAction: "RECOVER_EXECUTION_BINDING" },
        );
      }
      const transactionOwner = await transactionIndex.get(
        `${binding.storedIntent.chainRef}:${transactionHash.toLowerCase()}`,
      );
      if (transactionOwner !== objectKey(tenantId, intentId)) return null;
      if (observedState === "RPC_UNCERTAIN_AFTER_BROADCAST") {
        return execution.status === "RECONCILIATION_REQUIRED" ? clone(execution) : null;
      }
      const storedReceipt = await receipts.get(finalizationKey);
      if (!storedReceipt || !actualOutcome || !reconciliationEvidence) return null;
      const receipt = validatedReceiptOrThrow(storedReceipt, tenantId, intentId);
      const receiptExecution = receipt.execution as Record<string, unknown> | undefined;
      const receiptReconciliation = receipt.reconciliation as Record<string, unknown> | undefined;
      const receiptActual = receipt.actualEffects as Record<string, unknown> | undefined;
      const receiptEvidence = receiptReconciliation?.evidence;
      if (
        receiptExecution?.transactionHash !== transactionHash.toLowerCase() ||
        receiptExecution?.explorerUrl !== actualOutcome.explorerUrl ||
        receiptActual?.amountIn !== actualOutcome.amountIn ||
        receiptActual?.amountOut !== actualOutcome.amountOut ||
        receiptActual?.feeAmount !== actualOutcome.feeAmount ||
        hashCanonical(receiptEvidence) !== hashCanonical(reconciliationEvidence)
      ) {
        return null;
      }
      return {
        ...clone(execution),
        status: "CONFIRMED",
        confirmedAt: receipt.finalizedAt,
        actualOutcome: clone(actualOutcome),
        reconciliationStatus: receipt.reconciliationStatus,
      };
    };
    const applyReconciliation = async () => {
    const execution = clone(await requireTenantObject(executions, tenantId, intentId));
    const binding = await requireCurrentAuthorizationBinding({
      tenantId,
      intentId,
      authorizationId:
        typeof execution.authorizationId === "string" ? execution.authorizationId : null,
    });
    const { storedIntent, authorization, evaluation } = binding;
    if (
      execution.intentId !== intentId ||
      execution.intentRevision !== storedIntent.revision ||
      execution.authorizationId !== authorization.id ||
      execution.executionFingerprintHash !== binding.expectedFingerprintHash
    ) {
      throw new GuardError(
        "RECOVERY_REQUIRED",
        "Stored execution no longer matches its authorization and intent bindings.",
        { requiredAction: "RECOVER_EXECUTION_BINDING" },
      );
    }
    if (execution.transactionHash !== transactionHash.toLowerCase()) {
      throw new GuardError("FINGERPRINT_MISMATCH", "Transaction does not match execution.");
    }
    const txKey = `${storedIntent.chainRef}:${transactionHash.toLowerCase()}`;
    if ((await transactionIndex.get(txKey)) !== objectKey(tenantId, intentId)) {
      throw new GuardError(
        "FINGERPRINT_MISMATCH",
        "Transaction is not uniquely bound to this intent.",
      );
    }
    if ((await receipts.has(finalizationKey)) || execution.status === "CONFIRMED") {
      throw new GuardError(
        "IDEMPOTENCY_CONFLICT",
        "This execution already has an immutable finalized receipt.",
      );
    }
    if (observedState === "RPC_UNCERTAIN_AFTER_BROADCAST") {
      execution.status = "RECONCILIATION_REQUIRED";
      execution.reconciliationStatus = "RECONCILIATION_REQUIRED";
      await executions.set(objectKey(tenantId, intentId), execution);
      return clone(execution);
    }
    if (!actualOutcome) {
      throw new GuardError("VALIDATION_ERROR", "Confirmed execution requires actual outcome.");
    }
    const boundedFinancialDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
    if (
      ![actualOutcome.amountIn, actualOutcome.amountOut, actualOutcome.feeAmount].every(
        (value) =>
          typeof value === "string" &&
          value.length >= 1 &&
          value.length <= 128 &&
          boundedFinancialDecimal.test(value),
      )
    ) {
      throw new GuardError(
        "VALIDATION_ERROR",
        "Confirmed execution financial values must be bounded decimal strings.",
        { requiredAction: "CORRECT_RECONCILIATION_INPUT" },
      );
    }
    const expectedExplorerUrl =
      `https://testnet.arcscan.app/tx/${transactionHash.toLowerCase()}`;
    if (actualOutcome.explorerUrl !== expectedExplorerUrl) {
      throw new GuardError(
        "FINGERPRINT_MISMATCH",
        "Explorer URL does not match the transaction being reconciled.",
        { requiredAction: "CORRECT_RECONCILIATION_INPUT" },
      );
    }
    if (
      !reconciliationEvidence ||
      reconciliationEvidence.provider.length < 1 ||
      reconciliationEvidence.provider.length > 128 ||
      reconciliationEvidence.sourceRef.length < 1 ||
      reconciliationEvidence.sourceRef.length > 512 ||
      !Number.isFinite(Date.parse(reconciliationEvidence.observedAt)) ||
      !["PROVIDER_REPORTED", "ONCHAIN_VERIFIED"].includes(
        reconciliationEvidence.verificationStatus,
      ) ||
      !/^0x[0-9a-fA-F]{64}$/.test(reconciliationEvidence.responseDigest)
    ) {
      throw new GuardError(
        "EVIDENCE_INSUFFICIENT",
        "Confirmed execution requires explicit reconciliation provenance.",
      );
    }
    const observedAtMs = Date.parse(reconciliationEvidence.observedAt);
    const authorizationCreatedAtMs = Date.parse(String(authorization.createdAt));
    const authorizationExpiresAtMs = Date.parse(String(authorization.expiresAt));
    const nowMs = Date.parse(options.now());
    if (
      observedAtMs < authorizationCreatedAtMs ||
      observedAtMs > authorizationExpiresAtMs ||
      observedAtMs > nowMs
    ) {
      throw new GuardError(
        "FINGERPRINT_MISMATCH",
        "Observed transaction time is outside the authorization window.",
        { requiredAction: "RECORD_A_POST_AUTHORIZATION_TRANSACTION" },
      );
    }
    const finalizedAt = options.now();
    const confirmedExecution: Record<string, unknown> = {
      ...execution,
      status: "CONFIRMED",
      confirmedAt: finalizedAt,
      actualOutcome: clone(actualOutcome),
    };

    const quote = financialPlanEvidence(evaluation._evidence, storedIntent.actionType);
    const expectedEffects = expectedEffectsFromEvidence(quote);
    if (!quote || !expectedEffects) {
      throw new GuardError("EVIDENCE_INSUFFICIENT", "Receipt financial-plan evidence is missing.");
    }
    const actualEffects = {
      amountIn: actualOutcome.amountIn,
      amountOut: actualOutcome.amountOut,
      feeAmount: actualOutcome.feeAmount,
    };
    const reconciliationStatus =
      compareDecimalStrings(actualOutcome.amountIn, expectedEffects.amountIn) === 0 &&
      compareDecimalStrings(actualOutcome.amountOut, expectedEffects.minimumAmountOut) !== -1 &&
      compareDecimalStrings(actualOutcome.feeAmount, expectedEffects.feeAmount) !== 1
        ? "MATCHED"
        : "DEVIATION_RECORDED";
    confirmedExecution.reconciliationStatus = reconciliationStatus;
    const receiptCore = {
      schemaVersion: "1.1.0",
      id: options.createId("rcpt"),
      tenantId,
      evidenceStatus: evaluation.evidenceStatus,
      policyDecision: evaluation.policyDecision,
      authorizationStatus: "APPROVED",
      executionStatus: confirmedExecution.status,
      policyVersion: evaluation.policyVersion,
      policyDigest: evaluation.policyDigest,
      preflightHash: evaluation.preflightHash,
      expectedEffects,
      actualEffects,
      reconciliationStatus,
      intent: {
        id: storedIntent.id,
        revision: storedIntent.revision,
        hash: evaluation.intentHash,
      },
      evidence: {
        root: evaluation.evidenceRoot,
        refs: evaluation.evidenceRefs,
      },
      policy: {
        ...(evaluation.policyRef as Record<string, unknown>),
        hash: evaluation.policyDigest,
        outcome: evaluation.outcome,
      },
      authorization: {
        id: authorization.id,
        method: authorization.method,
        subjectRef: authorization.subjectRef,
        createdAt: authorization.createdAt,
        expiresAt: authorization.expiresAt,
        executionFingerprintHash: authorization.executionFingerprintHash,
      },
      execution: {
        id: confirmedExecution.id,
        fingerprintHash: confirmedExecution.executionFingerprintHash,
        bindingKind: confirmedExecution.bindingKind,
        productionCalldataBound: confirmedExecution.productionCalldataBound,
        transactionHash: confirmedExecution.transactionHash,
        status: confirmedExecution.status,
        explorerUrl: actualOutcome.explorerUrl,
      },
      reconciliation: {
        status: reconciliationStatus,
        expected: expectedEffects,
        actual: actualEffects,
        evidence: clone(reconciliationEvidence),
      },
      settlement: {
        status: "CONFIRMED",
        recoveryState: "NOT_REQUIRED",
      },
      createdAt: confirmedExecution.submittedAt,
      finalizedAt,
      limitations: [
        "ARC_TESTNET",
        "HACKATHON_PROTOTYPE",
        "NOT_AUDITED",
        "NOT_FINANCIAL_ADVICE",
        "PARTNER_AUTHENTICATED_AUTHORIZATION",
        ...(confirmedExecution.productionCalldataBound === false
          ? ["APP_KIT_REQUEST_BINDING_NOT_CALLDATA"]
          : []),
        ...(reconciliationEvidence.verificationStatus === "PROVIDER_REPORTED"
          ? ["PARTNER_REPORTED_RECONCILIATION"]
          : []),
      ],
    };
    const receiptHash = hashCanonical(receiptCore);
    const receiptWithoutIntegrity = { ...receiptCore, receiptHash };
    const receipt = {
      ...receiptWithoutIntegrity,
      integrity: {
        algorithm: "SHA-256",
        hash: hashCanonical(receiptWithoutIntegrity),
      },
    };
    const parsedReceipt = DecisionSettlementReceiptSchema.safeParse(receipt);
    if (!parsedReceipt.success) {
      throw new GuardError(
        "VALIDATION_ERROR",
        "Finalized receipt failed canonical schema validation.",
        { requiredAction: "CORRECT_RECONCILIATION_INPUT" },
      );
    }
    if (!(await receipts.insertIfAbsent(finalizationKey, parsedReceipt.data))) {
      throw new GuardError(
        "IDEMPOTENCY_CONFLICT",
        "Another reconciliation already finalized this execution.",
      );
    }
    return clone(confirmedExecution);
    };
    if (!idempotencyKey) return applyReconciliation();
    return withIdempotency(
      tenantId,
      "intent.reconcile",
      idempotencyKey,
      reconciliationRequest,
      applyReconciliation,
      recoverReconciliation,
    );
  }

  async function getIntent({ tenantId, intentId }: { tenantId: string; intentId: string }) {
    return clone(await requireTenantObject(intents, tenantId, intentId));
  }

  async function getEvaluation({
    tenantId,
    evaluationId,
  }: {
    tenantId: string;
    evaluationId: string;
  }) {
    /* A read is still a claim. The stored row passes the same seal, schema and
       current-intent checks the authorize path applies, so corrupted storage or
       same-revision intent drift can never be served back as COMPLETE /
       ALLOWED_BY_POLICY through an authenticated GET. */
    const evaluation = validatedStoredEvaluationOrThrow(
      await requireTenantObject(evaluations, tenantId, evaluationId),
    );
    const storedIntent = await requireTenantObject(intents, tenantId, evaluation.intentId);
    assertEvaluationIntentHashOrThrow(evaluation, storedIntent);
    return publicEvaluation(evaluation);
  }

  async function latestForIntent(
    collection: GuardCollection<Record<string, unknown>>,
    tenantId: string,
    intentId: string,
  ): Promise<Record<string, unknown> | null> {
    let latest: Record<string, unknown> | null = null;
    /* Scoped by key prefix so one tenant's status can never be assembled from
       another tenant's rows in a shared table. */
    for (const value of await collection.valuesWithPrefix(`${tenantId}:`)) {
      if (value.tenantId === tenantId && value.intentId === intentId) latest = value;
    }
    return latest;
  }

  function validatedReceiptOrThrow(
    value: Record<string, unknown>,
    tenantId: string,
    intentId: string,
  ): Record<string, unknown> {
    const parsed = DecisionSettlementReceiptSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.tenantId !== tenantId ||
      parsed.data.intent.id !== intentId
    ) {
      throw new GuardError(
        "RECOVERY_REQUIRED",
        "Stored receipt failed schema, relationship, or integrity validation.",
        { requiredAction: "RECOVER_FINALIZED_RECEIPT" },
      );
    }
    return parsed.data as unknown as Record<string, unknown>;
  }

  async function getStatus({ tenantId, intentId }: { tenantId: string; intentId: string }) {
    const intent = await requireTenantObject(intents, tenantId, intentId);
    /* Status is assembled only from rows that still validate. The evaluation is
       re-checked for seal, schema and current intent bytes, the authorization
       for seal and schema — the same gates the authorize/execute paths apply —
       so a drifted or corrupted row surfaces as RECOVERY_REQUIRED instead of
       reading as APPROVED. */
    const evaluationRow = await latestForIntent(evaluations, tenantId, intentId);
    const evaluation = evaluationRow ? validatedStoredEvaluationOrThrow(evaluationRow) : null;
    if (evaluation) assertEvaluationIntentHashOrThrow(evaluation, intent);
    const authorizationRow = await latestForIntent(authorizations, tenantId, intentId);
    const authorization = authorizationRow
      ? validatedStoredAuthorizationOrThrow(authorizationRow)
      : null;
    const execution = (await executions.get(objectKey(tenantId, intentId))) ?? null;
    const storedReceipt = (await receipts.get(objectKey(tenantId, intentId))) ?? null;
    const receipt = storedReceipt
      ? validatedReceiptOrThrow(storedReceipt, tenantId, intentId)
      : null;
    const receiptFinalized = receipt !== null;
    const authorizationExpiresAt = authorization
      ? Date.parse(String(authorization.expiresAt))
      : Number.NaN;
    const authorizationExpired =
      authorization !== null &&
      (!Number.isFinite(authorizationExpiresAt) ||
        authorizationExpiresAt <= Date.parse(options.now()));
    return clone({
      schemaVersion: "1.0.0",
      tenantId,
      intentId,
      intentRevision: intent.revision,
      evidenceStatus: evaluation?.evidenceStatus ?? "INSUFFICIENT",
      dataStatus: evaluation?.dataStatus ?? "INSUFFICIENT",
      policyDecision: evaluation?.policyDecision ?? "INSUFFICIENT_EVIDENCE",
      policyStatus: evaluation?.policyStatus ?? "NOT_EVALUATED",
      authorizationStatus:
        receipt?.authorizationStatus ??
        (authorization
          ? authorizationExpired
            ? "EXPIRED"
            : "APPROVED"
          : (evaluation?.authorizationStatus ?? "PENDING")),
      executionStatus: receipt?.executionStatus ?? execution?.status ?? "NOT_STARTED",
      policyVersion: evaluation?.policyVersion ?? intent.policyRef.version,
      policyDigest: evaluation?.policyDigest ?? null,
      preflightHash: evaluation?.preflightHash ?? null,
      expectedEffects: evaluation?.expectedEffects ?? null,
      actualEffects: receipt?.actualEffects ?? execution?.actualOutcome ?? null,
      reconciliationStatus: receipt?.reconciliationStatus ?? execution?.reconciliationStatus ?? "NOT_RECONCILED",
      receiptStatus: receiptFinalized ? "FINALIZED" : "NOT_FINALIZED",
      limitations: ["ARC_TESTNET", "HACKATHON_PROTOTYPE", ...storeLimitations],
    });
  }

  /**
   * The tenant's operations, newest first, with just enough state to render a
   * ledger row without a second call per intent.
   *
   * This is what makes the surface a workspace rather than a form: an operation
   * that vanishes when the page reloads was never really recorded, whatever the
   * screen said at the time. The scan is prefix-scoped, so one tenant's ledger
   * can never be assembled from another tenant's rows.
   */
  async function listIntents({ tenantId, limit = 50 }: { tenantId: string; limit?: number }) {
    const stored = await intents.valuesWithPrefix(`${tenantId}:`);
    const rows = await Promise.all(
      stored
        .filter((intent) => intent.tenantId === tenantId)
        .map(async (intent) => {
          const execution = await executions.get(objectKey(tenantId, intent.id));
          const storedReceipt = await receipts.get(objectKey(tenantId, intent.id));
          const receipt = storedReceipt
            ? validatedReceiptOrThrow(storedReceipt, tenantId, String(intent.id))
            : undefined;
          const receiptExecution = receipt?.execution as Record<string, unknown> | undefined;
          /* Field names follow the canonical Intent contract in contracts.ts —
             actionType, amount, sellAssetRef, recipient. Reading them by any
             other name yields `undefined`, which renders as a blank ledger cell
             rather than an error, so it is worth being exact here. */
          return {
            intentId: intent.id,
            revision: intent.revision,
            createdAt: intent.createdAt,
            actionType: intent.actionType,
            chainRef: intent.chainRef,
            amount: intent.amount,
            amountType: intent.amountType,
            sellAssetRef: intent.sellAssetRef,
            buyAssetRef: intent.buyAssetRef,
            recipient: intent.recipient ?? null,
            executionStatus:
              (receipt?.executionStatus as string | undefined) ??
              (execution?.status as string | undefined) ??
              "NOT_STARTED",
            reconciliationStatus:
              (receipt?.reconciliationStatus as string | undefined) ??
              (execution?.reconciliationStatus as string | undefined) ?? "NOT_RECONCILED",
            transactionHash:
              (receiptExecution?.transactionHash as string | undefined) ??
              (execution?.transactionHash as string | undefined) ??
              null,
            receiptStatus: receipt ? "FINALIZED" : "NOT_FINALIZED",
          };
        }),
    );
    /* Newest first by creation time, with the id as the tiebreaker so two
       intents created in the same millisecond still order deterministically
       across instances rather than by whichever row the database returned. */
    rows.sort((left, right) =>
      left.createdAt === right.createdAt
        ? right.intentId.localeCompare(left.intentId)
        : Date.parse(String(right.createdAt)) - Date.parse(String(left.createdAt)),
    );
    return clone({ intents: rows.slice(0, Math.max(1, Math.min(limit, 200))), total: rows.length });
  }

  async function getReceipt({ tenantId, intentId }: { tenantId: string; intentId: string }) {
    await requireTenantObject(intents, tenantId, intentId);
    const storedReceipt = await receipts.get(objectKey(tenantId, intentId));
    if (!storedReceipt) {
      throw new GuardError(
        "EXECUTION_NOT_CONFIRMED",
        "A finalized evidence receipt is not available for this intent.",
        { retryable: true, requiredAction: "RECONCILE_EXECUTION" },
      );
    }
    return clone(validatedReceiptOrThrow(storedReceipt, tenantId, intentId));
  }

  return {
    store,
    createIntent,
    getIntent,
    listIntents,
    preflight,
    getEvaluation,
    authorize,
    recordExecution,
    reconcileExecution,
    getStatus,
    getReceipt,
  };
}
