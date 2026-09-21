import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet: a bottom sheet on a phone, a centred dialog from 640px up.
 *
 * Everything a dialog owes the person using it: the page behind is inert and
 * does not scroll, Escape and the backdrop close it, Tab stays inside, and
 * focus goes back to whatever opened it. The scroll lock restores the exact
 * value it found, so closing one never leaves the page stuck.
 *
 * `hero` scrolls away with the content; the title sticks while the choices
 * scroll; `footer` is outside the scroll area, so the action is always in
 * reach.
 */
export function Sheet({
  title,
  description,
  eyebrow,
  hero,
  footer,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** A line under the title, such as a combo's saving. */
  eyebrow?: ReactNode;
  hero?: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.setAttribute("inert", "");
    root?.setAttribute("aria-hidden", "true");
    dialog.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog.current) return;
      const nodes = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      root?.removeAttribute("inert");
      root?.removeAttribute("aria-hidden");
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-dialog flex items-end justify-center bg-[#1F241C70] sm:items-center sm:p-7"
      onMouseDown={(e) => {
        // Only a press that starts on the backdrop closes: dragging a text
        // selection out of the sheet must not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[90dvh] w-full animate-sheet flex-col overflow-hidden rounded-t-[20px] bg-surface shadow-dialog focus:outline-none sm:w-[560px] sm:rounded-dialog"
      >
        <div className="overflow-y-auto overscroll-contain">
          {hero}
          <header className="sticky top-0 z-section flex items-start justify-between gap-[18px] border-b border-hairline bg-surface p-5 sm:px-[26px] sm:pb-[18px] sm:pt-[22px]">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-[28px] leading-[1.2] tracking-[-.7px] sm:text-[31px]">
                {title}
              </h2>
              {description && <p className="mt-2 text-[13px] text-muted">{description}</p>}
              {eyebrow}
            </div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </header>
          <div className="flex flex-col gap-[26px] p-5 sm:px-[26px] sm:py-[22px]">{children}</div>
        </div>
        <footer className="border-t border-hairline bg-surface px-5 pb-5 pt-[15px] sm:px-[26px] sm:pb-[22px] sm:pt-[17px]">
          {footer}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Minus, the number, plus. Named buttons, tabular figure.
 *
 * Minus disables at `min` and plus at `max`. Checkout passes `min={0}` and no
 * max, because there pressing minus on one removes the line and there is no
 * upper limit.
 */
export function QuantityStepper({
  value,
  min = 1,
  max,
  label,
  onChange,
  disabled = false,
}: {
  value: number;
  min?: number;
  max?: number;
  /** What is being counted, for the button names: "Fewer {label}". */
  label: string;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 items-center overflow-hidden rounded-field border border-hairline bg-surface">
      <button
        type="button"
        className="flex h-[46px] w-11 items-center justify-center disabled:opacity-[.35]"
        aria-label={`Fewer ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" />
      </button>
      <span className="tnum min-w-[25px] text-center text-sm" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="flex h-[46px] w-11 items-center justify-center disabled:opacity-[.35]"
        aria-label={`More ${label}`}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(value + 1)}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}
