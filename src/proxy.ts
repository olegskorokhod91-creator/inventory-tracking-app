import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (the exported function is
// now `proxy`, not `middleware`) — see next.config upgrade notes for v16.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session token if expired — required for Server Components,
  // which can't write cookies themselves.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // /api/* is excluded - those routes (e.g. the cron-triggered email
    // poller) have no browser session to check and handle their own auth.
    // manifest.webmanifest/icon/apple-icon (M8's PWA setup) must also be
    // public - a browser/OS fetches these to determine installability
    // before any login happens, and a redirect to the /login HTML page
    // instead of real JSON/image content breaks that outright. The
    // icon-*.png routes are already covered by the .png suffix exclusion
    // below; manifest.webmanifest and the extensionless icon/apple-icon
    // aren't, so they're listed explicitly.
    "/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon$|apple-icon$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
