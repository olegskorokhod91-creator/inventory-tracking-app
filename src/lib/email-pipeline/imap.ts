import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createAdminClient } from "@/lib/supabase/admin";
import { processEmail, type ProcessResult } from "./pipeline";

export type PollSummary = {
  fetched: number;
  results: ProcessResult[];
  errors: string[];
};

// IMAP's SINCE search is date-granularity only (not time), so this refetches
// the whole current day's messages on every poll rather than a precise
// "since last run" cursor - message_id idempotency in processEmail makes
// that overlap harmless. A real UID-checkpoint table would be more precise;
// not worth building at this email volume yet.
export async function pollInbox(): Promise<PollSummary> {
  const supabase = createAdminClient();
  const { data: latest } = await supabase
    .from("imported_emails")
    .select("received_at")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const since = latest ? new Date(latest.received_at) : new Date(0);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_IMAP_USER!,
      pass: process.env.GMAIL_IMAP_APP_PASSWORD!,
    },
    logger: false,
  });

  const results: ProcessResult[] = [];
  const errors: string[] = [];
  let fetched = 0;

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    const searchResult = await client.search({ since }, { uid: true });
    const uids = searchResult || [];

    for (const uid of uids) {
      fetched += 1;
      try {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) continue;

        const parsed = await simpleParser(message.source);
        const messageId = parsed.messageId ?? `imap-uid-${uid}`;

        const result = await processEmail({
          messageId,
          from: parsed.from?.value?.[0]?.address ?? "",
          subject: parsed.subject ?? "",
          text: parsed.text ?? "",
          receivedAt: parsed.date ?? new Date(),
        });
        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to process IMAP message", uid, message);
        errors.push(`uid ${uid}: ${message}`);
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();

  return { fetched, results, errors };
}
