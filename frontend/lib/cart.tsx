"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CartLine, Item, Option } from "./types";

type CartState = {
  lines: CartLine[];
  add: (item: Item, selected: Map<string, Option[]>, quantity: number, note?: string) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  count: number;
  previewSubtotal: number;
};

const CartContext = createContext<CartState | null>(null);
const STORAGE_KEY = "zenoeats.cart.v1";

export function CartProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const storageKey = `${STORAGE_KEY}.${slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* corrupt cart, start fresh */
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(storageKey, JSON.stringify(lines));
  }, [lines, hydrated, storageKey]);

  const value = useMemo<CartState>(() => {
    const add: CartState["add"] = (item, selected, quantity, note) => {
      const modifiers = [...selected.entries()].flatMap(([groupName, options]) =>
        options.map((o) => ({
          option_id: o.id,
          quantity: 1,
          label: `${groupName}: ${o.name}`,
          delta: o.price_delta_minor,
        }))
      );
      const unitPreviewMinor =
        item.base_price_minor + modifiers.reduce((sum, m) => sum + m.delta, 0);

      // Identical configurations merge into one line rather than stacking.
      const signature = [item.id, ...modifiers.map((m) => m.option_id).sort(), note ?? ""].join("|");

      setLines((prev) => {
        const match = prev.find((l) => l.key === signature);
        if (match) {
          return prev.map((l) =>
            l.key === signature ? { ...l, quantity: l.quantity + quantity } : l
          );
        }
        return [
          ...prev,
          {
            key: signature,
            menu_item_id: item.id,
            name: item.name,
            quantity,
            note,
            unitPreviewMinor,
            modifiers,
          },
        ];
      });
    };

    return {
      lines,
      add,
      remove: (key) => setLines((prev) => prev.filter((l) => l.key !== key)),
      setQuantity: (key, quantity) =>
        setLines((prev) =>
          quantity < 1
            ? prev.filter((l) => l.key !== key)
            : prev.map((l) => (l.key === key ? { ...l, quantity } : l))
        ),
      clear: () => setLines([]),
      count: lines.reduce((n, l) => n + l.quantity, 0),
      previewSubtotal: lines.reduce((n, l) => n + l.unitPreviewMinor * l.quantity, 0),
    };
  }, [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
