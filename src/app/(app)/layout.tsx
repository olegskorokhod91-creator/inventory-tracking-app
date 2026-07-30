import { getCurrentProfile } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { NavMenu } from "@/components/NavMenu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <NavMenu isAdmin={profile?.role === "admin"} />
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
