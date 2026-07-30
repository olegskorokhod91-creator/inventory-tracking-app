import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDataRetention } from "@/lib/data-retention";

// Triggered by Vercel Cron once deployed (see vercel.json); manually
// triggerable via curl for local testing - same pattern as poll-emails.
export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const supabase = createAdminClient();
    const summary = await runDataRetention(supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Data retention job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
