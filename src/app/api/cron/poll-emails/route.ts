import { NextResponse } from "next/server";
import { pollInbox } from "@/lib/email-pipeline/imap";

// Triggered by Vercel Cron once deployed (see vercel.json); manually
// triggerable via curl for local testing. Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` for configured cron jobs - if
// CRON_SECRET isn't set (local dev), the check is skipped entirely rather
// than blocking local testing.
export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const summary = await pollInbox();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Email poll failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
