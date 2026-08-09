import { permanentRedirect } from "next/navigation";

/**
 * Compatibility route.
 *
 * `/arc-guard` was the demo's first address and may already be written down in
 * notes and task records, so it keeps working. The canonical reviewer route is
 * `/arc` and the canonical demo route is `/arc/demo`; redirecting rather than
 * rendering keeps exactly one implementation of the demo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ArcGuardCompatibilityPage(): never {
  permanentRedirect("/arc/demo");
}
