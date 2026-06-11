"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid3X3, History, BookOpen, Settings } from "lucide-react";

interface BottomNavProps {
  /** When true, taps are disabled — used by the terminal while a sale is awaiting payment. */
  locked?: boolean;
}

/**
 * Shared bottom tab bar. One definition for every page so adding/removing a
 * nav item happens in exactly one place.
 *
 * Payment is "active" for any of the sale-flow paths (/, /items, /terminal).
 */
export function BottomNav({ locked = false }: BottomNavProps) {
  const pathname = usePathname();
  const lockClass = locked ? "pointer-events-none opacity-40" : "";

  const isPayment =
    pathname === "/" || pathname === "/items" || pathname === "/terminal";
  const isSettings = pathname?.startsWith("/settings") ?? false;

  const tab = (active: boolean) =>
    `flex flex-col items-center gap-0.5 transition ${lockClass} ${
      active ? "text-white" : "text-neutral-500 hover:text-neutral-300"
    }`;

  return (
    <nav className="shrink-0 border-t border-neutral-800 bg-black px-6 py-2">
      <div className="flex justify-around items-center max-w-md mx-auto">
        <Link href="/items" aria-disabled={locked} className={tab(isPayment)}>
          <Grid3X3 className="w-5 h-5" />
          <span className="text-[10px] font-medium">Payment</span>
        </Link>
        <Link
          href="/history"
          aria-disabled={locked}
          className={tab(pathname === "/history")}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px] font-medium">History</span>
        </Link>
        <Link
          href="/daily-reports"
          aria-disabled={locked}
          className={tab(pathname === "/daily-reports")}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px] font-medium">Reports</span>
        </Link>
        <Link
          href="/settings"
          aria-disabled={locked}
          className={tab(isSettings)}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] font-medium">Settings</span>
        </Link>
      </div>
    </nav>
  );
}
