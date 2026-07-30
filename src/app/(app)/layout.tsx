import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
          <Link href="/confirmations">Confirmations</Link>
          <Link href="/properties">Properties</Link>
          {profile?.role === "admin" && (
            <>
              <Link href="/orders">Orders</Link>
              <Link href="/orders/past">Past orders</Link>
              <Link href="/requests">Requests</Link>
              <Link href="/unmatched-updates">Unmatched</Link>
              <Link href="/owners">Owners</Link>
              <Link href="/reports/owner-billing">Billing report</Link>
              <Link href="/users">Users</Link>
            </>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {profile?.name} ({profile?.role})
          </span>
          <form action={logout}>
            <SubmitButton pendingText="Logging out…" className="underline">
              Log out
            </SubmitButton>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
