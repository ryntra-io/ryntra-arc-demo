import { getGuardCapabilities } from "../../../lib/guard/api.ts";
import { getArcVerificationStatus } from "../../../lib/guard/arc-verification.ts";
import { publicGuardResponse } from "../../../lib/guard/route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const arcStatus = getArcVerificationStatus();
  return publicGuardResponse(request, {
    schemaVersion: "1.0.0",
    data: getGuardCapabilities(),
    limitations: [
      "ARC_TESTNET",
      "HACKATHON_PROTOTYPE",
      ...(arcStatus.isCurrent
        ? ["TESTNET_VERIFIED_DIRECT_EOA_ERC20_USDC_TRANSFER_ONLY"]
        : ["RECORDED_RUN_REQUIRES_REVERIFICATION"]),
      "SWAP_NOT_VERIFIED",
      "GATE_C_NOT_COMPLETE",
    ],
  });
}
