import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { NavMenu } from "@/components/NavMenu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  // Batch-count, not item-count - it answers "how many separate things do
  // I need to go act on," which stays small and meaningful now that a
  // property can only ever have one open batch at a time.
  //
  // Deliberately NOT `.eq("status", "open")` - that column can drift from
  // what /requests actually shows (e.g. a batch shell created with zero
  // items, or any other status/items mismatch), so this counts the same
  // way the page itself does: a batch with at least one item still
  // missing resolved_by_order_id. Single source of truth for "open."
  let openRequestBatchCount = 0;
  if (profile?.role === "admin") {
    const supabase = await createClient();
    const { data: batches } = await supabase
      .from("supply_request_batches")
      .select("id, supply_requests(resolved_by_order_id)");
    openRequestBatchCount = (batches ?? []).filter((b) =>
      b.supply_requests.some((r) => !r.resolved_by_order_id),
    ).length;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <NavMenu
            isAdmin={profile?.role === "admin"}
            openRequestBatchCount={openRequestBatchCount}
          />
          <span className="text-sm font-semibold">Order Tracker</span>
        </div>
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
