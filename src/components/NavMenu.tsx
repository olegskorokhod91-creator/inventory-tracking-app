"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const CLEANER_ONLY_LINKS = [
  { href: "/confirmations", label: "Confirmations" },
];

const SHARED_LINKS = [{ href: "/properties", label: "Properties" }];

// Read-only cleaner order view - admins already have full /orders, so this
// is deliberately excluded from what admins see (was previously bundled
// into a shared CLEANER_LINKS array, giving admins two "Orders" entries).
const CLEANER_ORDERS_LINK = { href: "/my-orders", label: "Orders" };

const ADMIN_ONLY_LINKS = [
  { href: "/orders", label: "Orders" },
  { href: "/orders/past", label: "Past orders" },
  { href: "/requests", label: "Requests" },
  { href: "/unmatched-updates", label: "Unmatched" },
  { href: "/owners", label: "Owners" },
  { href: "/reports/owner-billing", label: "Billing report" },
  { href: "/users", label: "Users" },
];

// Replaces the old flat flex-wrap link row (M8) - that overflowed/wrapped
// awkwardly once admins had up to 9 links. A single dropdown scales to any
// number of links without a layout fight, and matches the pattern most
// mobile-first apps use for a nav with more than 3-4 items.
export function NavMenu({
  isAdmin,
  openRequestBatchCount = 0,
}: {
  isAdmin: boolean;
  openRequestBatchCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close on navigation - done during render (guarded by a prev-value ref),
  // not in a useEffect, per React's guidance against setState-in-effect
  // (same pattern already established in SupplyRequestForm.tsx).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const links = isAdmin
    ? [...SHARED_LINKS, ...ADMIN_ONLY_LINKS]
    : [...CLEANER_ONLY_LINKS, ...SHARED_LINKS, CLEANER_ORDERS_LINK];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Menu"
        className="flex h-11 w-11 items-center justify-center rounded-md border border-black/15 dark:border-white/20"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="15" x2="17" y2="15" />
        </svg>
      </button>

      {open && (
        <nav
          className="absolute left-0 top-full z-20 mt-2 flex w-56 flex-col overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-zinc-900"
          aria-label="Main"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {link.label}
              {link.href === "/requests" && openRequestBatchCount > 0 && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {openRequestBatchCount}
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
