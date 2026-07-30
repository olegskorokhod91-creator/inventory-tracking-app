// M8: live RLS audit — exercises the admin/cleaner boundary against a real
// Supabase project's REST/Auth API directly (not through the Next.js app),
// using throwaway accounts and data it creates and cleans up itself. Safe to
// run repeatedly against any environment, including the real hosted project
// — never touches existing rows, only what it seeds.
//
// Deliberately NOT the full Playwright suite pointed at a live URL: that
// would leave dozens of fake accounts/properties in a real project. This
// creates exactly 3 accounts and 2 properties, exercises the highest-stakes
// boundary on every RLS-protected table plus storage, then deletes
// everything it made.
//
// Usage: set three env vars for whichever project you're auditing, then run
// with plain `node` (no other setup needed):
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/rls-audit.mjs
//
// Never commit real values for these — export them in your shell only for
// the duration of the run. Nothing this script prints includes the key
// values themselves, so its output is safe to share.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY env vars. See the comment at the top of this file for usage.",
  );
  process.exit(1);
}

const stamp = Date.now();
const admin = createClient(URL, SERVICE_ROLE_KEY);

const results = [];
async function check(name, fn) {
  try {
    const ok = await fn();
    results.push({ name, ok, detail: ok === true ? null : String(ok) });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message ?? String(e) });
  }
}

// RLS blocks a read either by returning zero rows (the normal case) or by
// the request erroring outright (e.g. a table with no grant at all for this
// role) - both count as "blocked", so a check must tolerate either rather
// than only checking for an empty array.
function isBlocked({ data, error }) {
  return !!error || (Array.isArray(data) && data.length === 0);
}

async function signUpAndSignIn(email) {
  const anon = createClient(URL, ANON_KEY);
  const password = `AuditPass!${stamp}`;
  const { error: signUpError } = await anon.auth.signUp({ email, password });
  if (signUpError) throw signUpError;
  const { error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return anon;
}

async function main() {
  console.log(`RLS audit starting against ${URL}, stamp ${stamp}\n`);

  // --- Setup (service role — bypasses RLS by design, this is seeding) ---
  const { data: propA } = await admin
    .from("properties")
    .insert({ name: `RLS Audit Property A ${stamp}`, address: "1 Audit St" })
    .select("id")
    .single();
  const { data: propB } = await admin
    .from("properties")
    .insert({ name: `RLS Audit Property B ${stamp}`, address: "2 Audit St" })
    .select("id")
    .single();

  const cleanerAClient = await signUpAndSignIn(`rls-audit-cleaner-a-${stamp}@example.com`);
  const cleanerBClient = await signUpAndSignIn(`rls-audit-cleaner-b-${stamp}@example.com`);
  const adminTestClient = await signUpAndSignIn(`rls-audit-admin-${stamp}@example.com`);

  const { data: cleanerAUser } = await cleanerAClient.auth.getUser();
  const { data: cleanerBUser } = await cleanerBClient.auth.getUser();
  const { data: adminTestUser } = await adminTestClient.auth.getUser();

  await admin.from("profiles").update({ role: "admin" }).eq("id", adminTestUser.user.id);
  await admin
    .from("cleaner_property_assignments")
    .insert({ property_id: propA.id, user_id: cleanerAUser.user.id });
  await admin
    .from("cleaner_property_assignments")
    .insert({ property_id: propB.id, user_id: cleanerBUser.user.id });

  const { data: retailer } = await admin.from("retailers").select("id").eq("name", "Amazon").single();

  async function seedDeliveredOrder(propertyId, orderNumber) {
    const { data: order } = await admin
      .from("orders")
      .insert({
        retailer_id: retailer.id,
        property_id: propertyId,
        order_number: orderNumber,
        order_date: "2026-07-29",
        total_amount: 10,
        source: "manual",
      })
      .select("id")
      .single();
    const { data: item } = await admin
      .from("order_items")
      .insert({ order_id: order.id, name: "Audit Widget", expected_quantity: 1, unit_price: 10 })
      .select("id")
      .single();
    const { data: pkg } = await admin
      .from("packages")
      .insert({ order_id: order.id, status: "delivered", delivered_at: new Date().toISOString() })
      .select("id")
      .single();
    await admin.from("package_items").insert({ package_id: pkg.id, order_item_id: item.id, expected_quantity: 1 });
    return { orderId: order.id, packageId: pkg.id };
  }

  const orderA = await seedDeliveredOrder(propA.id, `RLS-AUDIT-A-${stamp}`);
  const orderB = await seedDeliveredOrder(propB.id, `RLS-AUDIT-B-${stamp}`);

  // --- Checks ---

  // Unauthenticated (anon key, no session) — should see nothing anywhere.
  const anonOnly = createClient(URL, ANON_KEY);
  await check("anon: cannot read orders", async () => {
    return isBlocked(await anonOnly.from("orders").select("id").eq("id", orderA.orderId));
  });
  await check("anon: cannot read properties", async () => {
    return isBlocked(await anonOnly.from("properties").select("id").eq("id", propA.id));
  });
  await check("anon: cannot read profiles", async () => {
    return isBlocked(await anonOnly.from("profiles").select("id"));
  });

  // Cleaner A: positive access to their own property.
  await check("cleaner A: can read own property's order", async () => {
    const { data } = await cleanerAClient.from("orders").select("id").eq("id", orderA.orderId);
    return data?.length === 1;
  });
  await check("cleaner A: can read own property's package", async () => {
    const { data } = await cleanerAClient.from("packages").select("id").eq("id", orderA.packageId);
    return data?.length === 1;
  });
  await check("cleaner A: can read retailers (M5 cleaner-view policy)", async () => {
    const { data } = await cleanerAClient.from("retailers").select("id").eq("id", retailer.id);
    return data?.length === 1;
  });

  // Cleaner A: negative — cannot see property B's anything.
  await check("cleaner A: cannot read property B's order", async () => {
    return isBlocked(await cleanerAClient.from("orders").select("id").eq("id", orderB.orderId));
  });
  await check("cleaner A: cannot read property B's package", async () => {
    return isBlocked(await cleanerAClient.from("packages").select("id").eq("id", orderB.packageId));
  });
  await check("cleaner A: cannot read property B itself", async () => {
    return isBlocked(await cleanerAClient.from("properties").select("id").eq("id", propB.id));
  });

  // Cleaner A: admin-only tables should be empty even though rows exist.
  await check("cleaner A: cannot read owners (admin-only)", async () => {
    return isBlocked(await cleanerAClient.from("owners").select("id"));
  });
  await check("cleaner A: cannot read imported_emails (admin-only)", async () => {
    return isBlocked(await cleanerAClient.from("imported_emails").select("id"));
  });
  await check("cleaner A: cannot read unmatched_updates (admin-only)", async () => {
    return isBlocked(await cleanerAClient.from("unmatched_updates").select("id"));
  });

  // Cleaner A: tamper guard on packages — disallowed field, disallowed status.
  await check("cleaner A: cannot set tracking_number directly", async () => {
    const { error } = await cleanerAClient
      .from("packages")
      .update({ tracking_number: "TAMPERED" })
      .eq("id", orderA.packageId);
    return !!error;
  });
  await check("cleaner A: cannot set status to cancelled directly", async () => {
    const { error } = await cleanerAClient.from("packages").update({ status: "cancelled" }).eq("id", orderA.packageId);
    return !!error;
  });

  // Cleaner A: cannot confirm a package on property B (cross-property RPC abuse).
  await check("cleaner A: confirm_package_delivery rejected for property B's package", async () => {
    const { error } = await cleanerAClient.rpc("confirm_package_delivery", {
      p_package_id: orderB.packageId,
      p_outcome: "all_correct",
      p_note: null,
      p_photo_path: null,
      p_items: [],
    });
    return !!error;
  });

  // Cleaner A: positive — can confirm their own property's package.
  await check("cleaner A: confirm_package_delivery succeeds for own property", async () => {
    const { error } = await cleanerAClient.rpc("confirm_package_delivery", {
      p_package_id: orderA.packageId,
      p_outcome: "all_correct",
      p_note: null,
      p_photo_path: null,
      p_items: [],
    });
    if (error) return error.message;
    const { data } = await admin.from("packages").select("status").eq("id", orderA.packageId).single();
    return data?.status === "confirmed_received";
  });

  // Storage: cleaner A can upload/read under their own package's folder,
  // not under property B's.
  const testBlob = new Blob(["audit"], { type: "image/jpeg" });
  await check("cleaner A: can upload a photo under their own package", async () => {
    const { error } = await cleanerAClient.storage
      .from("confirmation-photos")
      .upload(`${orderA.packageId}/audit.jpg`, testBlob, { contentType: "image/jpeg" });
    return !error;
  });
  await check("cleaner A: cannot upload a photo under property B's package", async () => {
    const { error } = await cleanerAClient.storage
      .from("confirmation-photos")
      .upload(`${orderB.packageId}/audit.jpg`, testBlob, { contentType: "image/jpeg" });
    return !!error;
  });

  // Admin (throwaway, promoted): positive control — sees everything.
  await check("admin: can read both properties' orders", async () => {
    const { data } = await adminTestClient
      .from("orders")
      .select("id")
      .in("id", [orderA.orderId, orderB.orderId]);
    return data?.length === 2;
  });
  await check("admin: can read owners/imported_emails/unmatched_updates", async () => {
    const [o, e, u] = await Promise.all([
      adminTestClient.from("owners").select("id").limit(1),
      adminTestClient.from("imported_emails").select("id").limit(1),
      adminTestClient.from("unmatched_updates").select("id").limit(1),
    ]);
    return !o.error && !e.error && !u.error;
  });

  // --- Report ---
  console.log("Results:\n");
  let failures = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    if (!r.ok) failures++;
  }
  console.log(`\n${results.length - failures}/${results.length} passed.`);

  // --- Cleanup (service role) — order matters: children before parents. ---
  await admin.storage.from("confirmation-photos").remove([`${orderA.packageId}/audit.jpg`, `${orderB.packageId}/audit.jpg`]);
  await admin.from("orders").delete().in("id", [orderA.orderId, orderB.orderId]);
  await admin.from("properties").delete().in("id", [propA.id, propB.id]);
  for (const u of [cleanerAUser.user, cleanerBUser.user, adminTestUser.user]) {
    await admin.auth.admin.deleteUser(u.id);
  }
  console.log("\nCleanup complete — all audit accounts/properties/orders removed.");

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Audit script crashed:", e);
  process.exit(1);
});
