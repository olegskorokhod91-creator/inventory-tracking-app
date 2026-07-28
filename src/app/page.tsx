import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/actions/auth";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Proxy already redirects unauthenticated requests to /login, but
  // Server Components can't rely on that alone — guard here too.
  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", user.id)
    .single();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">
        Logged in as {profile?.name || user.email}
      </h1>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Role: {profile?.role ?? "unknown"}
      </p>
      <form action={logout}>
        <button
          type="submit"
          className="h-11 rounded-md border border-black/15 px-5 text-base font-medium dark:border-white/20"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
