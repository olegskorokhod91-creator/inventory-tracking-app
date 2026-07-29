// Confirmation photos are capped at 5MB by the confirmation-photos Storage
// bucket itself (file_size_limit, enforced server-side no matter what -
// this client-side step is purely to avoid handing a cleaner an upload
// error for a normal phone photo that happens to exceed it). Only runs when
// the file actually needs it; an already-small photo is uploaded untouched.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const MIN_QUALITY = 0.4;

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (file.size <= MAX_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Unsupported browser or undecodable file - fall back to the original;
    // the bucket's own size limit still applies, just without a client-side
    // pre-check for this one case.
    return file;
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);

  let blob: Blob | null = null;
  for (let quality = 0.9; quality >= MIN_QUALITY; quality -= 0.1) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= MAX_BYTES) break;
  }
  if (!blob) return file;

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}
