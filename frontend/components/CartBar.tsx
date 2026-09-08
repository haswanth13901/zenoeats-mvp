"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";
import { money } from "@/lib/format";

export function CartBar({ currency, orderable }: { currency: string; orderable: boolean }) {
  const { count, previewSubtotal } = useCart();
  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 border-t border-hairline bg-surface/95 px-5 py-3 backdrop-blur">
      <Link
        href="/checkout"
        aria-disabled={!orderable}
        className={`btn-primary w-full ${orderable ? "" : "pointer-events-none opacity-40"}`}
      >
        <span>
          Review order · {count} {count === 1 ? "item" : "items"}
        </span>
        <span className="tnum ml-auto">{money(previewSubtotal, currency)}</span>
      </Link>
      <p className="mt-2 text-center text-xs text-muted">
        Tax is calculated at checkout.
      </p>
    </div>
  );
}
