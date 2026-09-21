import type { ReactNode } from "react";

/**
 * A board column: a coloured marker, the title and its count, then cards.
 * Shared by the kitchen board and Deliveries, so the two read as one system.
 * The dot is decoration beside words that already name the column.
 */
export function BoardColumn({
  title,
  count,
  dot,
  children,
}: {
  title: string;
  count: number;
  /** A background utility for the marker, e.g. "bg-brick". */
  dot: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h2 className="mb-[18px] flex items-center gap-2.5 text-sm font-semibold">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        {title}
        <span className="tnum ml-auto rounded-[5px] bg-[#EAE8E1] px-[7px] py-px text-caption">
          <span className="sr-only">(</span>
          {count}
          <span className="sr-only">)</span>
        </span>
      </h2>
      <div className="flex flex-col gap-[18px]">{children}</div>
    </section>
  );
}
