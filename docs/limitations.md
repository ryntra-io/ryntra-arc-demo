# Limitations and blockers

## Current implementation state

| Area | State | Evidence / required action |
|---|---|---|
| Guard schemas and deterministic policy | IMPLEMENTED / LOCAL GATES PASS | Clean npm 10 install, OpenAPI 3.1 validation, lint, typecheck, 802 tests with 797 PASS / 0 FAIL / 5 live-Postgres skips, and the 53-page production build pass. Corrective reviews `c76e911` and `a1f0555` returned `CHANGES_REQUESTED`; all reported P1s are corrected locally, but the review cap is consumed and no PASS/source close exists. |
| Independent status axes | IMPLEMENTED_NOT_VERIFIED_IN_DEPLOYMENT | `evidenceStatus`, `policyDecision`, authorization, `executionStatus`, and `reconciliationStatus` are separate in source/OpenAPI. |
| Evidence provenance contract | IMPLEMENTED_NOT_VERIFIED_IN_DEPLOYMENT | Required provider/source/freshness/coverage/availability/verification/digest/reason fields exist; no third-party security/compliance credentials or integrations exist. |
| Versioned `/v1` API and OpenAPI | IMPLEMENTED / DEPLOYED SHA UNPROVEN | Public routes answer, but the running deployment has not been tied to the corrected exact candidate. Deployment remains a separately authorized action. |
| Headless TypeScript integration client | IMPLEMENTED_NOT_PUBLISHED | Private local package and one server example only; no npm publication. |
| Reference client | PUBLIC URL EXISTS / FINAL CANDIDATE NOT VERIFIED | `https://ryntra-arc-testnet.vercel.app/arc/demo` answers publicly. The current deployment SHA is unproven and the corrected source has not been deployed or re-verified there. |
| Preserved App Kit USDC-to-EURC path | WORKING_WITH_LIMITS / LIVE NOT VERIFIED | Source path remains. Permissionless estimate smoke returned HTTP 403 for missing authorization; exact live quote, liquidity, final calldata, wallet execution, and swap remain unverified. |
| EOA ERC-20 USDC transfer fallback | ONE RECORDED TESTNET RUN | One owner-authorized direct-EOA transfer confirmed and reconciled `MATCHED`. This verifies the exact recorded operation only; repeatability, reliability, a swap, and production use remain unverified. |
| Arc Testnet RPC reachability | RESOLVED 2026-08-07 | Arc's primary host `https://rpc.testnet.arc.io` bans Ukraine at the WAF (Cloudflare error 1009, confirmed in the founder's own browser and from the agent sandbox, with and without browser-like headers). The three provider mirrors Arc documents alongside it — Blockdaemon, dRPC, QuickNode — answer normally from both networks. Both the server (`ARC_TESTNET_RPC_URL`) and the wallet network definition (`NEXT_PUBLIC_ARC_TESTNET_RPC_URL`) are now configurable, defaulting to Arc's primary. A malformed or non-HTTPS value is a startup error, never a silent fallback. |
| Arc Testnet chain and USDC contract | VERIFIED 2026-08-07 | Read live through `rpc.blockdaemon.testnet.arc.io`: chain id `0x4cef52` = 5042002 as pinned in source; ERC-20 USDC at `0x3600000000000000000000000000000000000000` has 1,798 bytes of deployed bytecode, `decimals()` = 6, `symbol()` = `name()` = `USDC`. This supersedes the earlier `contract bytecode NOT VERIFIED` state. Native and ERC-20 views report the same underlying balance at 18 and 6 decimals respectively, which is exactly the `ARC_NATIVE_ERC20_INTERFACE_AMBIGUITY` the Arc pack normalizes. |
| Server-side preflight against live Arc | VERIFIED 2026-08-07 | `PREPARE_TRANSFER` through the local demo API returned HTTP 201 with a real gas estimate from the chain (`feeAmount 0.001021345938`), evidence bound to a real block height, `evidenceStatus COMPLETE`, `missingEvidence []`, `policyDecision ALLOWED_BY_POLICY`, `executionStatus NOT_STARTED`, an exact-calldata transaction prepared, and `memoSupported false`. Insufficient balance fails closed with `ARC_TRANSFER_INSUFFICIENT_BALANCE`; the current check reserves the normalized transfer amount and gas against the one underlying balance represented by both Arc USDC interfaces. That preflight request itself did not sign or broadcast; the later owner-authorized run is recorded below. |
| Arc Testnet transaction | RECORDED 2026-08-06 | `0x6476dc81a38f0cbe385eab5162f391d7954a992a443db7d268e07b2698b8d5f9`, block `55677295`, status `0x1`, block timestamp `2026-08-06T22:19:23Z`. Owner-authorized in the founder's own wallet; Ryntra never held a key. Explorer: https://testnet.arcscan.app/tx/0x6476dc81a38f0cbe385eab5162f391d7954a992a443db7d268e07b2698b8d5f9 |
| Arc dual `Transfer` event | HANDLED, CONFIRMED LIVE | The one movement emitted two events — 18-decimal native precompile and 6-decimal ERC-20. Reconciliation matches only the ERC-20 log. Reading the wrong one is a 10^12 error. |
| Expected-versus-actual reconciliation | VERIFIED 2026-08-07 | `MATCHED` · `ONCHAIN_VERIFIED`. Expected fee 0.001548973026, actual 0.001530838950 read from the chain. Receipt `0xb1530b1273adf5efd0a41ab194546da2c17f58d1842384a281dac173478e64f2`; hash and SHA-256 integrity recomputed independently of the application. |
| Gate C reliability | NOT COMPLETE | One successful run is not a reliability claim. Idempotency under load, replay/TOCTOU protection, RPC failure handling, recovery and monitoring remain unproven. |
| Transaction Memo | NOT IMPLEMENTED | `memoSupported: false`. Optional only after exact direct-EOA compatibility is verified; SCA/Safe/ERC-4337 support is not claimed. |
| Durable single-writer store | IMPLEMENTED | `RYNTRA_GUARD_STORE=file` persists the whole lifecycle across cold start under one writer; the default remains in-process memory. |
| Multi-writer store / multi-instance operation | IMPLEMENTED · CURRENT LIVE SUITE NOT RUN | `RYNTRA_GUARD_STORE=postgres` with `DATABASE_URL` declares `DURABLE_MULTI_WRITER` and satisfies the write gate. Idempotency keys, intent ids and transaction hashes use atomic claims. The live round-trip, concurrent-claim, shared-state and tenant-prefix tests in `lib/guard/store-postgres.test.mjs` were not run in this audit because `DATABASE_URL` is unavailable. |
| Dependency audit | 0 HIGH/CRITICAL · 16 LOW META-RECORDS | The patched Jayson child uses `uuid@11.1.1`; both full and production npm 10 audits pass the high threshold. Circle's current `@ethersproject` graph still pulls `elliptic@6.6.1`, whose advisory has no patched release. npm's force suggestion is a breaking Circle adapter downgrade and was not applied. |
| Security audit | NOT DONE | Required public label remains `NOT AUDITED`. |
| Public repository | EXISTS / STALE | `https://github.com/squadic-ai/ryntra-arc-demo` is public; observed `main` at `e16107fcbbee7bc0f134c1bbccae306cdbe02b0a`. It trails the corrected private candidate and still contains unsafe/stale claims. Synchronization/publication is not authorized in this session. |
| Public demo / deck / reviewer page | URLS EXIST / EXACT CANDIDATE UNVERIFIED | The URLs answer logged out, but the deployment SHA is unproven and corrected source is not deployed. Re-verify only after an authorized exact-candidate release. |
| Final demo video | MISSING / RE-RENDER REQUIRED | `/arc/video` is a correction notice that deliberately withholds the invalid historical MP4. The tracked historical blob is excluded from Vercel uploads by its exact public path, so it cannot bypass that notice in a candidate deployment. A corrected video requires separate render, publication authority, and logged-out verification. |
| Anonymous demo authorization | FAILS CLOSED | `/api/arc-guard` may estimate and prepare unsigned preflight material, but it cannot authorize, record execution, or reconcile. Those mutations require authenticated `/v1`; the demo cookie is not partner authentication or wallet-ownership proof. |
| CI and exact-candidate review | LOCAL GATES PASS / TASK BLOCKED | GitHub Actions for `342daa0` failed at `npm ci`; the repaired local branch passes the recorded local gates. Exact reviews `c76e911` and `a1f0555` returned `CHANGES_REQUESTED`; their P1 findings are locally corrected, but the allowed focused follow-up is consumed. Explicit founder authorization for one additional read-only exact-candidate review is required; it is not PASS and grants no source close or external action. |
| Encode track, description, final submission | FOUNDER ACTION REMAINS | Artifacts exist, but the final form's track and description must be checked against the exact candidate. Only the owner presses Submit. |

## Explicit non-claims

This prototype does not prove that an asset is safe, prevent losses, guarantee settlement, provide custody, perform AML/KYT, replace transaction simulation/security, operate on mainnet, support every Arc application, or hold an Arc/Circle partnership. It is not the first transaction firewall, first policy engine, or only execution-receipt product.

No live integration is claimed for Blockaid, Hypernative, TRM, Chainalysis, Fordefi, Fireblocks, Turnkey, Circle Compliance Engine, Circle Agent Wallet policies, or any other provider without actual credentials, working code, and fresh test evidence.

## App Kit swap limitation

The current swap estimate is bound to chain, pair, amount, recipient, slippage, quote hash, and request hash. It is **not** the final onchain target/calldata. The authorization record therefore cannot authorize a swap wallet transaction yet. Swap execution stays disabled until an exact external-signing payload is captured, re-preflighted, and freshly authorized with one-time replay protection.

## EOA transfer limitation

The transfer fallback is direct EOA only. It prepares an ERC-20 `transfer(address,uint256)` call to the Arc Testnet ERC-20 USDC interface, while native USDC remains separately normalized for gas. The recorded transaction proves that one exact owner-authorized transfer confirmed and reconciled `MATCHED`; it does not prove another wallet, route, amount, repeated operation, App Kit swap, reliability, mainnet, or production readiness.

## Evidence limitation

`INSUFFICIENT_EVIDENCE` describes completeness for the configured policy; it is not a unique market or safety claim. Provider timeouts and unsupported coverage remain explicit and cannot become `ALLOWED_BY_POLICY`. Provider-reported evidence is not described as independently audited by Ryntra.

## Memo limitations

If Arc Transaction Memo is later used, it may contain only `preflightHash` or another bounded digest/reference. No PII, email, wallet portfolio, raw policy, full receipt, jurisdiction, secret, or private partner metadata may be placed onchain. The direct caller must be verified as an EOA. Smart-account, Safe, and ERC-4337 flows retain `memoSupported: false`.
