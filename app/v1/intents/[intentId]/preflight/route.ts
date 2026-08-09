import {
  ARC_DEMO_POLICY,
  parsePreflightRequest,
  readBoundedGuardJson,
  requireIdempotencyKey,
} from "../../../../../lib/guard/api.ts";
import {
  ARC_USDC_TRANSFER_POLICY,
  assertArcUsdcTransferPolicyBinding,
} from "../../../../../lib/guard/arc-usdc-transfer.ts";
import { requireGuardPathId, withGuardApi } from "../../../../../lib/guard/route.ts";
import { GuardError } from "../../../../../lib/guard/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ intentId: string }> },
) {
  return withGuardApi(request, async ({ tenantId, service }) => {
    const intentId = requireGuardPathId((await params).intentId);
    const idempotencyKey = requireIdempotencyKey(request.headers.get("idempotency-key"));
    const body = parsePreflightRequest(await readBoundedGuardJson(request));
    const intent = await service.getIntent({ tenantId, intentId });
    const policy =
      intent.actionType === "SWAP" &&
      intent.policyRef.id === ARC_DEMO_POLICY.id &&
      intent.policyRef.version === ARC_DEMO_POLICY.version
        ? ARC_DEMO_POLICY
        : intent.actionType === "SEND" &&
            intent.policyRef.id === ARC_USDC_TRANSFER_POLICY.id &&
            intent.policyRef.version === ARC_USDC_TRANSFER_POLICY.version
          ? ARC_USDC_TRANSFER_POLICY
          : null;
    if (!policy) {
      throw new GuardError(
        "CAPABILITY_UNAVAILABLE",
        "No server-owned policy is available for this intent action and policy reference.",
        { requiredAction: "USE_A_SUPPORTED_SERVER_POLICY" },
      );
    }
    if (policy.id === ARC_USDC_TRANSFER_POLICY.id) {
      assertArcUsdcTransferPolicyBinding({
        intent,
        evidence: body.evidence,
      });
    }
    return {
      data: await service.preflight({
        tenantId,
        intentId,
        evidence: body.evidence as unknown as Parameters<typeof service.preflight>[0]["evidence"],
        policy,
        idempotencyKey,
      }),
    };
  });
}
