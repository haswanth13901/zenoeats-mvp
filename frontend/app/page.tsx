"use client";

import { useEffect, useState } from "react";
import { CartBar } from "@/components/CartBar";
import { ModifierSheet } from "@/components/ModifierSheet";
import { api, errorMessage, isAbort } from "@/lib/api";
import { CartProvider, useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import type { Item, Meal, Portal } from "@/lib/types";

/** The storefront. Public: no session is required to read a menu, and the
 *  tenant comes from the Host header, so this page never names a restaurant
 *  itself. Signing in happens at /checkout, where the middleware asks. */
export default function MenuPage() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      api<Portal>("/portal", { signal: ac.signal }),
      api<{ meals: Meal[] }>("/menu", { signal: ac.signal }),
    ])
      .then(([p, m]) => {
        setPortal(p);
        setMeals(m.meals);
      })
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ac.abort();
  }, []);

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">This menu isn&apos;t available</h1>
        <p className="mt-3 text-sm text-muted">{error}</p>
      </main>
    );
  }

  if (!portal || !meals) {
    return <main className="px-5 py-24 text-center text-muted">Loading…</main>;
  }

  return (
    <CartProvider slug={portal.slug}>
      <Storefront portal={portal} meals={meals} />
    </CartProvider>
  );
}

function Storefront({ portal, meals }: { portal: Portal; meals: Meal[] }) {
  const { add } = useCart();
  const [customizing, setCustomizing] = useState<Item | null>(null);

  const open = portal.is_orderable && portal.accepting_orders;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto max-w-3xl px-5 py-10">
          <h1 className="font-display text-4xl leading-tight">{portal.name}</h1>
          {portal.tagline && <p className="mt-2 text-muted">{portal.tagline}</p>}
          {!open && (
            <p className="mt-4 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
              Not taking orders right now. You can still look at the menu.
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        {meals.length === 0 && (
          <p className="border border-dashed border-hairline px-4 py-12 text-center text-sm text-muted">
            Nothing on the menu yet.
          </p>
        )}

        {meals.map((meal) => (
          <section key={meal.id} className="mb-10">
            {meals.length > 1 && (
              <h2 className="font-display text-2xl">{meal.name}</h2>
            )}

            {meal.categories.map((category) => (
              <section key={category.id} className="mt-6">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
                  {category.name}
                </h3>
                <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
                  {category.items.map((item) => (
                    <li key={item.id}>
                      <button
                        className="flex w-full items-start gap-4 py-4 text-left disabled:opacity-40"
                        disabled={!item.is_available || !open}
                        onClick={() => setCustomizing(item)}
                      >
                        <div className="flex-1">
                          <p className="text-[15px]">{item.name}</p>
                          {item.description && (
                            <p className="mt-0.5 max-w-prose text-sm text-muted">
                              {item.description}
                            </p>
                          )}
                          {!item.is_available && (
                            <p className="mt-1 text-sm text-brick">Sold out</p>
                          )}
                        </div>
                        <span className="tnum text-[15px]">
                          {money(item.base_price_minor, item.currency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>
        ))}
      </main>

      <CartBar currency={portal.currency} orderable={open} />

      {customizing && (
        <ModifierSheet
          item={customizing}
          currency={portal.currency}
          onClose={() => setCustomizing(null)}
          onAdd={(selected, quantity, note) =>
            add(customizing, selected, quantity, note)
          }
        />
      )}
    </div>
  );
}
