import { useCallback, useRef, useState } from "react";
import { PhotoIcon } from "@/components/common/icons";
import { errorMessage } from "@/services/apiClient";
import { shrinkForUpload } from "@/utils/image";
import { uploadImage, type ImageKind, type UploadedImage } from "../restaurantApi";

/** The photo a form is holding: a key to save and a URL to preview, or both
 *  null when there is none. */
export type ImageDraft = { path: string | null; url: string | null };

export const NO_IMAGE: ImageDraft = { path: null, url: null };

export function imageDraft(uploaded: UploadedImage | null): ImageDraft {
  return uploaded ? { path: uploaded.image_path, url: uploaded.image_url } : NO_IMAGE;
}

/**
 * Choose, replace or remove the photo of an item or an option.
 *
 * Choosing uploads straight away and hands the new key to the form; it does
 * not save anything. The photo reaches the menu when the form it sits in is
 * saved, so cancelling that form really does leave the menu as it was --
 * the same contract every other field in this builder keeps.
 *
 * Two sizes. `md` is for a form with room, and says what it does in words.
 * `sm` sits in a dense row of inputs, where it is a thumbnail that opens the
 * file chooser and a small cross to take the photo off.
 *
 * `onBusyChange` lets the form hold its Save button while a photo is still
 * uploading. Without it, saving mid-upload would quietly save the row without
 * the photo the manager had just chosen.
 */
export function ImagePicker({
  kind,
  image,
  label,
  size = "md",
  disabled = false,
  onChange,
  onError,
  onBusyChange,
}: {
  kind: ImageKind;
  image: ImageDraft;
  /** What the photo is of, for screen readers: "Smash Burger". */
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onChange: (next: ImageDraft) => void;
  onError: (message: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const off = disabled || busy;

  async function upload(file: File) {
    setBusy(true);
    onBusyChange?.(true);
    try {
      const photo = await shrinkForUpload(file);
      const stored = await uploadImage(kind, photo.blob, photo.filename);
      onChange(imageDraft(stored));
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      // Cleared so choosing the same file again, after a failure, still fires.
      if (input.current) input.current.value = "";
    }
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      // Named formats rather than image/*. It is the list the server accepts,
      // and it is what makes an iPhone convert a HEIC photo to JPEG as it
      // hands it over instead of sending something that would be refused.
      accept="image/jpeg,image/png,image/webp"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void upload(file);
      }}
    />
  );

  const thumbnail = (box: string) => (
    <button
      type="button"
      disabled={off}
      onClick={() => input.current?.click()}
      aria-label={image.url ? `Change the photo of ${label}` : `Add a photo of ${label}`}
      title={image.url ? "Change photo" : "Add photo"}
      className={`${box} relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-paper text-muted hover:border-ink disabled:hover:border-hairline`}
    >
      {image.url ? (
        <img src={image.url} alt="" className="h-full w-full object-cover" />
      ) : (
        <PhotoIcon />
      )}
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/80 text-[10px] text-ink">
          …
        </span>
      )}
    </button>
  );

  if (size === "sm") {
    return (
      <span className="relative inline-flex shrink-0">
        {thumbnail("h-9 w-9")}
        {image.url && !busy && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(NO_IMAGE)}
            aria-label={`Remove the photo of ${label}`}
            title="Remove photo"
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[10px] leading-none text-white"
          >
            ×
          </button>
        )}
        {fileInput}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {thumbnail("h-20 w-20")}
      <div className="flex flex-col items-start gap-1 text-xs">
        <button
          type="button"
          className="text-muted underline"
          disabled={off}
          onClick={() => input.current?.click()}
        >
          {busy ? "Uploading…" : image.url ? "change photo" : "add a photo"}
        </button>
        {image.url && !busy && (
          <button
            type="button"
            className="text-brick underline"
            disabled={disabled}
            onClick={() => onChange(NO_IMAGE)}
          >
            remove photo
          </button>
        )}
        <span className="text-muted">JPEG, PNG or WebP.</span>
      </div>
      {fileInput}
    </div>
  );
}

/**
 * How many photos a form is still uploading, and the callback that keeps
 * count. A counter rather than a flag, because a list editor can have
 * several rows uploading at once and the first to finish must not release
 * Save while the others are still on their way.
 */
export function useUploadsInFlight(): [number, (busy: boolean) => void] {
  const [count, setCount] = useState(0);
  const track = useCallback((busy: boolean) => {
    setCount((n) => Math.max(0, n + (busy ? 1 : -1)));
  }, []);
  return [count, track];
}
