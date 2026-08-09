import type { Metadata } from "next";

import { ArcGuardDemo } from "@/app/arc-guard/arc-guard-demo";

/**
 * The canonical direct demo route (canon §22.12).
 *
 * It reuses the existing demo component rather than duplicating it: `/arc-guard`
 * redirects here, so there is one implementation and one place a defect can be
 * fixed. The route stays `noindex` — the demo is a live prototype surface whose
 * state is per-run, and `/arc` is the page a reviewer should land on.
 */
export const metadata: Metadata = {
  title: "Arc Testnet Demo — Ryntra Guard",
  description:
    "A testnet-only reference client for unsigned preflight and historical reconciliation evidence; lifecycle mutations require the authenticated partner API.",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://ryntra.io/arc/demo" },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ArcDemoPage() {
  return <ArcGuardDemo />;
}
