import { requireAdmin } from "@/lib/auth";
import { ImportCsvForm } from "./ImportCsvForm";

export default async function ImportCsvPage() {
  await requireAdmin();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Import Amazon Business CSV</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Upload the Business Analytics &quot;Orders&quot; report whenever you
        choose — matching is by order number, so uploading the same or an
        overlapping report again is safe and won&apos;t create duplicates.
      </p>
      <ImportCsvForm />
    </div>
  );
}
