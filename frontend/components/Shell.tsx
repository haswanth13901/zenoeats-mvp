"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

/** Operator chrome. Deliberately plainer than the customer portal: this is a
 *  tool people use all shift, not a storefront. */
export function Shell({
  title,
  nav,
  children,
  action,
}: {
  title: string;
  nav: { href: string; label: string }[];
  children: React.ReactNode;
  /** Replaces the Clerk UserButton. The platform admin portal has no Clerk
   *  session, so its sign-out has to end the admin cookie instead. */
  action?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3">
          <span className="font-display text-lg">{title}</span>
          <nav className="flex flex-1 gap-1">
            {nav.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded px-3 py-1.5 text-sm ${
                    active ? "bg-ink text-white" : "text-muted hover:bg-paper"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          {action ?? <UserButton afterSignOutUrl="/" />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
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

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mb-4 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
      {message}
    </p>
  );
}
