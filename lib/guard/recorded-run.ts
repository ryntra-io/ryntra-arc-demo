import {
  ARC_TESTNET_NETWORK,
  explorerTransactionUrl,
} from "./networks.ts";

/**
 * The one recorded Arc Public Testnet run.
 *
 * Both the machine-readable API and reviewer UI project this evidence. Keeping
 * the proof in one pure-data module prevents either layer from retaining a
 * stale hand-written status without pulling server dependencies into clients.
 */
const transactionHash =
  "0x6476dc81a38f0cbe385eab5162f391d7954a992a443db7d268e07b2698b8d5f9";

export const ARC_RECORDED_RUN = {
  network: "Arc Public Testnet",
  chainId: ARC_TESTNET_NETWORK.chainId,
  operation: "Direct-EOA ERC-20 USDC transfer",
  transactionHash,
  explorerUrl: explorerTransactionUrl(ARC_TESTNET_NETWORK, transactionHash),
  blockNumber: "55677295",
  /** Timestamp returned with the confirmed receipt by Arc Testnet RPC. */
  blockTimestamp: "2026-08-06T22:19:23.000Z",
  onchainStatus: "SUCCESS (0x1)",
  intentId: "int_58e9bf523de5438c9bc118b5ec1e7dd1",
  receiptId: "rcpt_b6b010ec3d5e4be19b4c26cdfce28e73",
  preflightHash: "0xb9d52657e4ed10933e63b57adf597f8d1f75d7055d87206570155e92a0ae799c",
  policyDigest: "0x4134277b4a9b0660f8844de8aebb2b59f491d4e4138a52a9da6a7ebab257f8aa",
  executionFingerprintHash: "0x9dc7552c2cc6271474c89bd1930aec1cdbda01549b7b0d707cabe31e28ee93ed",
  evidenceRoot: "0x24aaa5bdc8db9129e87f3c4df03a2d0109b596375450d6d9a3883254d01e50fe",
  receiptHash: "0xb1530b1273adf5efd0a41ab194546da2c17f58d1842384a281dac173478e64f2",
  integrityHash: "0xed006ede12c4e99648a089e401a661d4e7d8c6c9afe5a0ea9892228327ebd1fe",
  amount: "1.000000 USDC",
  expectedFee: "0.001548973026 USDC",
  actualFee: "0.001530838950 USDC",
  evidenceStatus: "COMPLETE",
  policyDecision: "ALLOWED_BY_POLICY",
  authorizationStatus: "APPROVED",
  executionStatus: "CONFIRMED",
  reconciliationStatus: "MATCHED",
  verificationStatus: "ONCHAIN_VERIFIED",
  authorizationMethod: "PARTNER_AUTHENTICATED, recorded separately from the wallet signature",
  dualEventNote:
    "Arc emitted this single movement as two Transfer events — 1000000000000000000 from the native precompile at 18 decimals, and 1000000 from the ERC-20 interface at 6. Reconciliation reads only the ERC-20 log, so the recorded amount is 1.000000 USDC rather than a 10^12 error.",
} as const;
