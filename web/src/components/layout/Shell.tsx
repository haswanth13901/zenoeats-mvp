import { useEffect, useRef, type ReactNode } from "react";
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
 *
 * ---
 *
 * On a phone the tab row scrolls sideways rather than stretching the page.
 * `flex-1` alone did not shrink it: a flex item's min-width is `auto`, so a
 * row of seven tabs set the width of the header and every portal page scrolled
 * horizontally at 390px -- the whole document 789px wide, with the sign-out
 * button off the right edge. `min-w-0` is what lets it shrink; `overflow-x-auto`
 * is what makes the overflow the nav's problem instead of the page's.
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
  const activeTab = useRef<HTMLAnchorElement>(null);

  // Bring the current tab into view when the row is scrolled. Without it an
  // admin on a phone lands on Settings with the row showing Kitchen, which
  // reads as the wrong page being open.
  //
  // Keyed on the tabs as well as the path: before the guard answers, the row
  // holds only the tabs every role has, and the rest appear a beat later
  // without the path changing. Watching the path alone meant the scroll ran
  // against a row that did not yet contain the active tab, and never again.
  const tabKey = nav.map((n) => n.href).join("|");
  useEffect(() => {
    activeTab.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname, tabKey]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap sm:gap-x-6">
          {/* A fixed slot, whatever the name is. A restaurant called "The
              Spice House of Whitefield" would otherwise push the nav along
              and move every tab, so the wordmark keeps one width and a long
              name is cut with the full text on hover. Narrower on a phone,
              where 176px is most of the screen. */}
          {titleHref ? (
            <Link
              to={titleHref}
              title={title}
              className="order-1 block w-28 shrink-0 truncate font-display text-lg hover:opacity-70 sm:w-44"
            >
              {title}
            </Link>
          ) : (
            <span
              title={title}
              className="order-1 block w-28 shrink-0 truncate font-display text-lg sm:w-44"
            >
              {title}
            </span>
          )}
          {/* Its own row on a phone, so seven tabs get the whole width instead
              of the ~100px left beside the name and the sign-out button. One
              row again from 640px, where everything fits across. */}
          <nav className="no-scrollbar order-3 flex w-full min-w-0 gap-1 overflow-x-auto sm:order-2 sm:w-auto sm:flex-1">
            {nav.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  ref={active ? activeTab : undefined}
                  to={n.href}
                  // shrink-0: tabs scroll out of view rather than squashing
                  // into slivers no one can read or hit.
                  className={`shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm ${
                    active ? "bg-ink text-white" : "text-muted hover:bg-paper"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="order-2 ml-auto sm:order-3 sm:ml-0">{action}</div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
