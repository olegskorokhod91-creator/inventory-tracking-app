import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Next.js 16 requires cookies() to be awaited (no sync fallback), so this
// helper is async — call it as `await createClient()` in server components,
// route handlers, and server actions.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component that can't set cookies directly;
            // the proxy handles session refresh in that case instead.
          }
        },
      },
    },
  );
}
