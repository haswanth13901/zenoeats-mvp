import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

/**
 * A credential shown exactly once: a temporary password, with what to do
 * with it.
 *
 * Amber, because losing it has a consequence (it can only be reissued), and
 * selectable in one click as well as copyable, because a manager on a tablet
 * may have no clipboard to paste from. Nothing here stores or re-fetches the
 * value: it lives only as long as the component that was handed it.
 */
export function OneTimeSecret({
  title,
  children,
  secret,
  link,
  footer,
}: {
  title: ReactNode;
  /** What to do with it, in full. */
  children?: ReactNode;
  /** The password, or nothing when none was issued (an existing login). */
  secret?: string | null;
  /** The address the person signs in at, selectable. */
  link?: string;
  footer?: ReactNode;
}) {
  const value = useRef<HTMLParagraphElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // No clipboard (an insecure origin, or a refused permission): select
      // it instead, so a long-press copy still works.
      const range = document.createRange();
      if (value.current) {
        range.selectNodeContents(value.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <div className="secret animate-fade" role="status">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Icon name="lock" />
        {title}
      </h3>
      {children && <div className="mt-3">{children}</div>}
      {secret && (
        <>
          <p className="mt-3 text-caption font-semibold">Shown once</p>
          <p ref={value} className="secret-value">
            {secret}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-quiet btn-compact" onClick={() => void copy()}>
              <Icon name="copy" className="h-4 w-4" />
              Copy password
            </button>
            <span className="text-caption text-muted" aria-live="polite">
              {copied ? "Copied." : ""}
            </span>
          </div>
        </>
      )}
      {link && <p className="mt-3 select-all text-caption [overflow-wrap:anywhere]">{link}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
