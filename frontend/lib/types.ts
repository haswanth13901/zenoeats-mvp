export type Option = {
  id: string;
  name: string;
  price_delta_minor: number;
  is_default: boolean;
  is_available: boolean;
};

export type ModifierGroup = {
  id: string;
  name: string;
  selection_type: "SINGLE" | "MULTI";
  is_required: boolean;
  min_select: number;
  max_select: number;
  options: Option[];
};

export type Item = {
  id: string;
  name: string;
  description: string | null;
  base_price_minor: number;
  currency: string;
  is_available: boolean;
  image_path: string | null;
  modifier_groups: ModifierGroup[];
};

export type Category = { id: string; name: string; kind: string; items: Item[] };
export type Meal = { id: string; name: string; categories: Category[] };

export type Portal = {
  restaurant_id: string;
  slug: string;
  name: string;
  tagline: string | null;
  currency: string;
  is_orderable: boolean;
  accepting_orders: boolean;
  stripe_publishable_key: string;
  stripe_account_id: string | null;
};

export type CartLine = {
  key: string;
  menu_item_id: string;
  name: string;
  quantity: number;
  note?: string;
  unitPreviewMinor: number; // display only; the server reprices everything
  modifiers: { option_id: string; quantity: number; label: string; delta: number }[];
};

export type Amounts = {
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
};

export type Order = {
  order_id: string;
  order_number: number;
  status: string;
  payment_status: string;
  currency: string;
  amounts: Amounts;
  items: {
    name: string;
    quantity: number;
    unit_price_minor: number;
    line_total_minor: number;
    item_note: string | null;
    modifiers: { group_name: string; option_name: string; unit_price_delta_minor: number; quantity: number }[];
  }[];
  pickup_pin: string | null;
  expires_at: string | null;
  created_at: string;
};
