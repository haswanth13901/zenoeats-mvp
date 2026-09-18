import { useState } from "react";

/**
 * A menu photo, or nothing.
 *
 * Nothing rather than a placeholder, in both cases that matter: an item with
 * no photo is the ordinary case and the row should read exactly as it did
 * before photos existed, and a photo that fails to load is better gone than
 * shown as a broken-image icon beside the dish a customer is choosing.
 *
 * Lazy and asynchronously decoded, because a long menu is mostly off screen
 * and a phone should not fetch forty photos to show the first four. The size
 * comes from the caller's classes, so the row keeps its shape while the
 * photo is on its way instead of jumping when it lands.
 *
 * The failure is remembered per URL. A later photo for the same row, after a
 * manager replaces one, gets its own chance to load.
 */
export function MenuImage({
  src,
  className,
  alt = "",
  onFail,
}: {
  src: string | null | undefined;
  className: string;
  /** Empty by default: every photo sits beside the item's name, which already
   *  says what it is, and a screen reader should not read the name twice. */
  alt?: string;
  /** For a caller whose layout reserves room for the photo -- a card's image
   *  column -- so it can give that room back rather than keep an empty box. */
  onFail?: (src: string) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return null;

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        setFailed(src);
        onFail?.(src);
      }}
      className={className}
    />
  );
}
