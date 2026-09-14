import type { ReactNode } from "react";

/** Dashed placeholder for an empty collection or a load in progress. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

/** Renders nothing when there is no message, so callers can pass a nullable
 *  error straight through without guarding at every call site. */
export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="mb-4 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
      {message}
    </p>
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
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="font-display text-3xl">{value}</div>
    </div>
  );
}

const PILL: Record<string, string> = {
  ACTIVE: "bg-ink text-white",
  DRAFT: "border border-hairline text-muted",
  SUSPENDED: "bg-brick/10 text-brick",
  ARCHIVED: "border border-hairline text-muted",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs ${PILL[status] ?? PILL.DRAFT}`}>
      {status}
    </span>
  );
}
