import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export type NavItem = { href: string; label: string };

/**
 * Operator chrome, shared by the platform and restaurant portals.
 *
 * Deliberately plainer than the customer storefront: this is a tool people use
 * all shift, not a shopfront.
 *
 * `action` is required rather than defaulted. The Next version fell back to a
 * third-party user button that rendered nothing useful for either portal --
 * both authenticate against platform-issued credentials it knew nothing about.
 * Making it explicit means a portal cannot accidentally ship without a way to
 * sign out.
 *
 * `titleHref` turns the wordmark into a link home. It is optional because a
 * portal with a single page has nowhere to go, and a wordmark that navigates
 * to the page you are already on is a dead control.
 */
export function Shell({
  title,
  titleHref,
  nav,
  action,
  children,
}: {
  title: string;
  titleHref?: string;
  nav: NavItem[];
  action: ReactNode;
  children: ReactNode;
}) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3">
          {/* A fixed slot, whatever the name is. A restaurant called "The
              Spice House of Whitefield" would otherwise push the nav along
              and move every tab, so the wordmark keeps one width and a long
              name is cut with the full text on hover. */}
          {titleHref ? (
            <Link
              to={titleHref}
              title={title}
              className="block w-44 shrink-0 truncate font-display text-lg hover:opacity-70"
            >
              {title}
            </Link>
          ) : (
            <span
              title={title}
              className="block w-44 shrink-0 truncate font-display text-lg"
            >
              {title}
            </span>
          )}
          <nav className="flex flex-1 gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                to={n.href}
                className={`rounded px-3 py-1.5 text-sm ${
                  pathname === n.href ? "bg-ink text-white" : "text-muted hover:bg-paper"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          {action}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
