/**
 * Shrinking a photo in the browser before it is uploaded.
 *
 * A phone photo straight off the camera roll is often 4 to 12 MB and 4000
 * pixels wide. The server stores nothing larger than 1600 pixels, so sending
 * the original spends a manager's mobile data on pixels that are thrown away
 * on arrival, and the biggest ones would not fit through the request limit
 * at all.
 *
 * This is a courtesy, not a safeguard. The server decodes, resizes and
 * re-encodes every upload regardless, so whatever this sends is checked
 * again -- which is also why every failure here falls back to sending the
 * original and letting the server give the real answer.
 */

/** A little over the server's longest edge, so its own resize still has
 *  something to work with and the result is not softened twice. */
const MAX_EDGE = 2000;

/** Small enough to send untouched. Keeping the original matters for a PNG
 *  with transparency, which re-encoding to JPEG would flatten. */
const SEND_AS_IS_BYTES = 1.5 * 1024 * 1024;

const JPEG_QUALITY = 0.9;

export type ShrunkPhoto = { blob: Blob; filename: string };

export async function shrinkForUpload(file: File): Promise<ShrunkPhoto> {
  const original = { blob: file, filename: file.name || "photo" };

  let bitmap: ImageBitmap;
  try {
    // from-image applies the EXIF orientation, so a portrait photo is drawn
    // upright rather than on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // A format this browser cannot decode. The server may still refuse it,
    // but it should be the one to say so, in its own words.
    return original;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_EDGE && file.size <= SEND_AS_IS_BYTES) return original;

    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return original;

    // JPEG has no transparency, and a transparent pixel encodes as black.
    // White is what a menu photo with a cut-out background was meant to sit on.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return original;

    const stem = (file.name || "photo").replace(/\.[^.]*$/, "");
    return { blob, filename: `${stem}.jpg` };
  } finally {
    bitmap.close();
  }
}
