import { useRef, useState } from "react";
import { framing } from "@/features/storefront/components/HomePresentation";

export type Framing = { focal_x: number; focal_y: number; zoom: number };

export const DEFAULT_FRAMING: Framing = { focal_x: 50, focal_y: 60, zoom: 100 };

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
/** One press of an arrow key. Coarse enough to be worth pressing, fine enough
 *  to land on a face. */
const STEP = 2;

/**
 * Choose what survives the banner's crop.
 *
 * A banner is a fixed shape and a photograph is whatever shape it was taken
 * in, so something is always cut off. Only the person who chose the photo
 * knows what it was for -- the dish, the shopfront, the face -- so this is
 * the control that asks them, rather than cropping the same way every time
 * and hoping.
 *
 * The preview is the real thing: it frames the photo through the same
 * function the storefront renders with, so what is dragged here is what a
 * customer sees. Dragging moves the photograph, not the window onto it,
 * which is the way round every photo tool behaves.
 */
export function BannerFraming({
  image,
  value,
  onChange,
  disabled = false,
  label,
}: {
  image: string;
  value: Framing;
  onChange: (framing: Framing) => void;
  disabled?: boolean;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  function nudge(dx: number, dy: number) {
    onChange({ ...value, focal_x: clamp(value.focal_x + dx), focal_y: clamp(value.focal_y + dy) });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const surface = box.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    // Zoomed in, the photo overflows further, so the same drag would throw it
    // across the frame. Dividing by the zoom keeps the photo moving with the
    // pointer at any magnification.
    const speed = 100 / (value.zoom / 100);
    let last = { x: event.clientX, y: event.clientY };
    let live = value;
    surface.setPointerCapture(event.pointerId);
    setDragging(true);

    const move = (e: PointerEvent) => {
      // Dragging right shows more of the photo's left-hand side, so the
      // anchor travels the opposite way to the pointer.
      live = {
        ...live,
        focal_x: clamp(live.focal_x - ((e.clientX - last.x) / rect.width) * speed),
        focal_y: clamp(live.focal_y - ((e.clientY - last.y) / rect.height) * speed),
      };
      last = { x: e.clientX, y: e.clientY };
      onChange(live);
    };
    const done = () => {
      setDragging(false);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", done);
      surface.removeEventListener("pointercancel", done);
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", done);
    surface.addEventListener("pointercancel", done);
  }

  const untouched =
    value.focal_x === DEFAULT_FRAMING.focal_x &&
    value.focal_y === DEFAULT_FRAMING.focal_y &&
    value.zoom === DEFAULT_FRAMING.zoom;

  return (
    <div className="my-3">
      <span className="label mb-2 block">Framing</span>
      <div
        ref={box}
        role="group"
        aria-label={`Framing for ${label}. Drag the photo, or use the arrow keys, to choose what shows.`}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          const by = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[event.key];
          if (!by || disabled) return;
          event.preventDefault();
          nudge(by[0]!, by[1]!);
        }}
        className={`relative aspect-[3/2] w-full select-none overflow-hidden rounded-field border border-hairline bg-hero ${
          disabled ? "" : dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <img
          src={image}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full object-cover"
          style={framing(value)}
        />
        {/* Where the words sit on the real banner, so nobody centres the
            subject behind their own headline. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[38%] bg-gradient-to-r from-hero via-hero/80 to-transparent" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex min-w-[210px] flex-1 items-center gap-3 text-caption">
          <span className="shrink-0">Zoom {value.zoom}%</span>
          <input
            className="min-w-0 flex-1"
            type="range"
            min={100}
            max={200}
            step={5}
            disabled={disabled}
            value={value.zoom}
            aria-label={`Zoom for ${label}`}
            onChange={(event) => onChange({ ...value, zoom: Number(event.target.value) })}
          />
        </label>
        <button
          type="button"
          className="link min-h-11"
          disabled={disabled || untouched}
          onClick={() => onChange({ ...DEFAULT_FRAMING })}
        >
          Reset framing
        </button>
      </div>
      <p className="field-hint" aria-live="polite">
        Drag the photo to choose what stays in view. Horizontal {value.focal_x}%, vertical {value.focal_y}%.
      </p>
    </div>
  );
}
