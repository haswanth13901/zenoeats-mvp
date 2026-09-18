import type { ReactNode, Ref } from "react";

/** Dashed placeholder for an empty collection or a load in progress. */
export function Empty({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`empty ${className}`}>{children}</div>;
}

/** A spinner that keeps its place in a line of text. Hidden from assistive
 *  technology: the words beside it say what is happening. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none ${className}`}
    />
  );
}

/** The empty box, holding a load in progress. */
export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div className="empty flex items-center justify-center gap-3" role="status">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/**
 * A whole page that is one message: loading, not found, can't reach, empty
 * cart. Centred, with the heading, the full sentence and at most one way on.
 * `illustration` is decoration beside words that already say it all.
 */
export function StatePage({
  title,
  children,
  action,
  illustration,
  busy = false,
}: {
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  illustration?: ReactNode;
  /** A load in progress: announced politely, with a spinner beside the words. */
  busy?: boolean;
}) {
  return (
    <main
      className="mx-auto flex min-h-[75vh] max-w-[570px] flex-col items-center justify-center px-6 pb-[60px] pt-20 text-center sm:min-h-[80vh] sm:pt-[60px]"
      role={busy ? "status" : undefined}
    >
      {illustration && <div className="mb-[22px]">{illustration}</div>}
      {title && (
        <h1 className="mb-4 font-display text-[35px] leading-[1.12] tracking-[-1px] sm:text-4xl">{title}</h1>
      )}
      {children && (
        <div className="flex items-center gap-3 text-body text-muted">
          {busy && <Spinner />}
          <p>{children}</p>
        </div>
      )}
      {action && <div className="mt-6">{action}</div>}
    </main>
  );
}

/** Renders nothing when there is no message, so callers can pass a nullable
 *  error straight through without guarding at every call site.
 *
 *  The whole server sentence, never truncated: the API's messages say what
 *  is wrong and what to do, and a clipped one says neither. */
export function ErrorNote({
  message,
  className = "mb-4",
}: {
  message: string | null | undefined;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p role="alert" className={`note-error ${className}`}>
      {message}
    </p>
  );
}

/** A neutral result or consequence the reader should see. `tone` gives money
 *  and one-time-secret consequences their warning colour. Never auto-dismissed. */
export function Notice({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "success";
  className?: string;
}) {
  const kind = tone === "warning" ? "note-warning" : tone === "success" ? "note-success" : "note";
  return (
    <div role="status" className={`${kind} ${className}`}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  /** A node rather than a string, so a heading can carry the pencil that
   *  opens everything under it. */
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold leading-snug">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A settings-style heading: serif title, one line of context. */
export function SettingsHeading({
  id,
  title,
  subtitle,
  headingRef,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex items-center">
      <div className="min-w-0">
        <h2
          id={id}
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-[25px] leading-tight tracking-[-.5px] focus:outline-none sm:text-[27px]"
        >
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-caption text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

/** Figures in a bordered grid. The 1px gaps over a hairline background draw
 *  the dividers, whatever the column count at each width. */
export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid gap-px overflow-hidden rounded-ticket border border-hairline bg-hairline ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface p-[18px] sm:p-[23px]">
      <div className="text-caption text-muted">{label}</div>
      <div
        className="tnum mt-2 font-display text-[27px] leading-tight tracking-[-.7px] sm:text-[33px]"
        style={{ overflowWrap: "anywhere" }}
      >
        {value}
      </div>
    </div>
  );
}

// Colour never says a status alone: each pill carries its word.
const PILL: Record<string, string> = {
  ACTIVE: "pill-on",
  DRAFT: "pill text-muted",
  SUSPENDED: "pill-red",
  ARCHIVED: "pill text-muted",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={PILL[status] ?? PILL.DRAFT}>{status}</span>;
}
