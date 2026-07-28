import { createAdminClient } from "@/lib/supabase/admin";
import { classifyEmailBySubject, extractSenderDomain } from "./classify";
import { extractOrderConfirmation, extractShippingUpdate } from "./extract";

export type IncomingEmail = {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  receivedAt: Date;
};

export type ProcessResult =
  | { type: "duplicate" }
  | { type: "unknown" }
  | { type: "order_confirmation"; orderId: string }
  | { type: "order_confirmation"; error: string }
  | { type: "shipping_update"; packageId: string }
  | { type: "shipping_update"; unmatched: true };

// The one function both the live IMAP poller and tests call - kept separate
// from IMAP/mailparser concerns so the matching logic can be exercised
// directly with plain objects, no real mailbox needed.
export async function processEmail(email: IncomingEmail): Promise<ProcessResult> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("imported_emails")
    .select("id")
    .eq("message_id", email.messageId)
    .maybeSingle();
  if (existing) {
    return { type: "duplicate" };
  }

  const { data: retailers } = await supabase
    .from("retailers")
    .select("id, name, domain")
    .not("domain", "is", null);

  const knownDomains = (retailers ?? [])
    .map((r) => r.domain)
    .filter((domain): domain is string => Boolean(domain));
  const senderDomain = extractSenderDomain(email.from);
  const emailType = classifyEmailBySubject(email.subject, senderDomain, knownDomains);

  const { data: importedEmail, error: logError } = await supabase
    .from("imported_emails")
    .insert({
      message_id: email.messageId,
      sender: email.from,
      subject: email.subject,
      received_at: email.receivedAt.toISOString(),
      parsed_type: emailType,
      match_status: "pending",
    })
    .select("id")
    .single();

  if (logError || !importedEmail) {
    throw new Error(`Failed to log imported email: ${logError?.message}`);
  }

  if (emailType === "unknown") {
    await supabase
      .from("imported_emails")
      .update({ match_status: "unmatched" })
      .eq("id", importedEmail.id);
    return { type: "unknown" };
  }

  if (emailType === "order_confirmation") {
    const retailer = (retailers ?? []).find((r) =>
      r.domain ? senderDomain.toLowerCase().endsWith(r.domain.toLowerCase()) : false,
    );

    if (!retailer) {
      await supabase
        .from("imported_emails")
        .update({ match_status: "error" })
        .eq("id", importedEmail.id);
      return { type: "order_confirmation", error: "No retailer matched the sender domain" };
    }

    const extraction = await extractOrderConfirmation({
      subject: email.subject,
      from: email.from,
      text: email.text,
    });

    if (!extraction.is_order_confirmation || !extraction.order_number || !extraction.order_date) {
      await supabase
        .from("imported_emails")
        .update({ match_status: "error" })
        .eq("id", importedEmail.id);
      return { type: "order_confirmation", error: "Extraction incomplete or not actually a confirmation" };
    }

    const { data: orderId, error } = await supabase.rpc("upsert_order_from_pipeline", {
      p_source: "email",
      p_retailer_id: retailer.id,
      p_order_number: extraction.order_number,
      p_order_date: extraction.order_date,
      p_total_amount: extraction.total_amount,
      p_po_number: null,
      p_items: null,
    });

    if (error || !orderId) {
      await supabase
        .from("imported_emails")
        .update({ match_status: "error" })
        .eq("id", importedEmail.id);
      return { type: "order_confirmation", error: error?.message ?? "upsert failed" };
    }

    await supabase
      .from("imported_emails")
      .update({ match_status: "created_order", created_order_id: orderId })
      .eq("id", importedEmail.id);
    return { type: "order_confirmation", orderId };
  }

  // shipping_update
  const extraction = await extractShippingUpdate({
    subject: email.subject,
    from: email.from,
    text: email.text,
  });

  if (!extraction.is_shipping_update) {
    await supabase
      .from("imported_emails")
      .update({ match_status: "unmatched" })
      .eq("id", importedEmail.id);
    return { type: "shipping_update", unmatched: true };
  }

  if (!extraction.order_number && !extraction.tracking_number) {
    await supabase.from("unmatched_updates").insert({
      imported_email_id: importedEmail.id,
      reason: "No order number or tracking number found in the email",
      extracted_order_number: extraction.order_number,
      extracted_tracking_number: extraction.tracking_number,
      extracted_carrier: extraction.carrier,
      extracted_status: extraction.status,
    });
    await supabase
      .from("imported_emails")
      .update({ match_status: "unmatched" })
      .eq("id", importedEmail.id);
    return { type: "shipping_update", unmatched: true };
  }

  const { data: packageId, error: matchError } = await supabase.rpc("apply_shipping_update", {
    p_order_number: extraction.order_number,
    p_tracking_number: extraction.tracking_number,
    p_carrier: extraction.carrier,
    p_status: extraction.status,
    p_expected_delivery_date: extraction.expected_delivery_date,
  });

  if (matchError || !packageId) {
    await supabase.from("unmatched_updates").insert({
      imported_email_id: importedEmail.id,
      reason: matchError ? matchError.message : "Neither order number nor tracking number matched an existing order",
      extracted_order_number: extraction.order_number,
      extracted_tracking_number: extraction.tracking_number,
      extracted_carrier: extraction.carrier,
      extracted_status: extraction.status,
    });
    await supabase
      .from("imported_emails")
      .update({ match_status: "unmatched" })
      .eq("id", importedEmail.id);
    return { type: "shipping_update", unmatched: true };
  }

  await supabase
    .from("imported_emails")
    .update({ match_status: "updated_order" })
    .eq("id", importedEmail.id);
  return { type: "shipping_update", packageId };
}
