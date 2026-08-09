import { ARC_RECORDED_RUN } from "./recorded-run.ts";

/**
 * Demo-local equivalent of the private capability-registry lookup.
 *
 * The private repository resolves this status from its typed Capability
 * Registry (six `arc-testnet-*` rows, all `testnet`, lastVerifiedAt below,
 * 30-day rolling review window for live/route claims). This extraction cannot
 * carry that registry, so it carries the exact row values instead and applies
 * the same fail-closed rule: when the review window lapses, the undated
 * current-capability claim degrades to RE-VERIFYING everywhere at once, while
 * the dated historical transaction remains a dated historical fact.
 */
export const ARC_LIFECYCLE_CAPABILITY_IDS = [
  "arc-testnet-intent",
  "arc-testnet-preflight",
  "arc-testnet-wallet-authorization",
  "arc-testnet-settlement",
  "arc-testnet-reconciliation",
  "arc-testnet-receipt",
] as const;

/** The registry rows' shared lastVerifiedAt at extraction time. */
const ARC_LIFECYCLE_LAST_VERIFIED_AT = "2026-08-08";
/** Canon's rolling review window for live/route claims, in days. */
const REVIEW_WINDOW_DAYS = 30;

export type ArcVerificationStatus = Readonly<{
  state: "TESTNET_VERIFIED" | "RE_VERIFYING";
  label: string;
  isCurrent: boolean;
  lastVerifiedAt: string;
  recordedAt: string;
}>;

export function getArcVerificationStatus(now = new Date()): ArcVerificationStatus {
  const verifiedAt = Date.parse(`${ARC_LIFECYCLE_LAST_VERIFIED_AT}T00:00:00.000Z`);
  const windowMs = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const isCurrent =
    Number.isFinite(verifiedAt) && now.getTime() - verifiedAt <= windowMs && now.getTime() >= verifiedAt;
  return {
    state: isCurrent ? "TESTNET_VERIFIED" : "RE_VERIFYING",
    label: isCurrent
      ? "TESTNET VERIFIED — direct-EOA ERC-20 USDC transfer only"
      : `RE-VERIFYING — recorded Arc Testnet transfer proof from ${ARC_RECORDED_RUN.blockTimestamp.slice(0, 10)}`,
    isCurrent,
    lastVerifiedAt: ARC_LIFECYCLE_LAST_VERIFIED_AT,
    recordedAt: ARC_RECORDED_RUN.blockTimestamp,
  };
}
