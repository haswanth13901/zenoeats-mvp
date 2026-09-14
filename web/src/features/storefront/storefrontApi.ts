import { api } from "@/services/api";
import type { Amounts, Meal, Order, Portal } from "@/types";

export type QuoteItem = {
  menu_item_id: string;
  quantity: number;
  note?: string;
  modifiers: { option_id: string; quantity: number }[];
};

/** A combo as the API takes it: which deal, which choices, how many. No
 *  price, here or anywhere else the client speaks. */
export type QuoteCombo = {
  combo_id: string;
  quantity: number;
  note?: string;
  selections: {
    slot_id: string;
    menu_item_id: string;
    modifiers: { option_id: string; quantity: number }[];
  }[];
};

/**
 * The customer surface.
 *
 * Branding, menu and ordering. Which restaurant is resolved from the Host
 * header, so nothing here carries a tenant id.
 *
 * The order endpoints need a signed-in customer. Customers authenticate
 * through Clerk, so those requests carry Clerk's session token -- fetched by
 * the base query (customerAuth), never by a page.
 */
export const storefrontApi = api.injectEndpoints({
  endpoints: (build) => ({
    portal: build.query<Portal, void>({
      query: () => ({ url: "/portal" }),
      providesTags: ["Portal"],
    }),

    publicMenu: build.query<{ meals: Meal[] }, void>({
      query: () => ({ url: "/menu" }),
      providesTags: ["Menu"],
    }),

    /** Authoritative pricing. Whatever the cart showed locally is a guess
     *  until the server answers. Creates nothing. */
    quote: build.mutation<
      { currency: string; amounts: Amounts },
      { items: QuoteItem[]; combos: QuoteCombo[] }
    >({
      query: (body) => ({ url: "/orders/quote", method: "POST", body }),
    }),

    createOrder: build.mutation<
      Order,
      {
        items: QuoteItem[];
        combos: QuoteCombo[];
        customer_note: string | null;
        expected_total_minor: number;
        idempotencyKey: string;
      }
    >({
      query: ({ idempotencyKey, ...body }) => ({
        url: "/orders",
        method: "POST",
        body,
        customerAuth: true,
        idempotencyKey,
      }),
    }),

    createPaymentIntent: build.mutation<
      { client_secret: string; stripe_account_id: string; publishable_key: string },
      { orderId: string; idempotencyKey: string }
    >({
      query: ({ orderId, idempotencyKey }) => ({
        url: `/orders/${orderId}/payment-intent`,
        method: "POST",
        body: {},
        customerAuth: true,
        idempotencyKey,
      }),
    }),

    order: build.query<Order, string>({
      query: (orderId) => ({ url: `/orders/${orderId}`, customerAuth: true }),
      providesTags: (_r, _e, orderId) => [{ type: "Order", id: orderId }],
    }),
  }),
});

export const {
  usePortalQuery,
  usePublicMenuQuery,
  useQuoteMutation,
  useCreateOrderMutation,
  useCreatePaymentIntentMutation,
  useOrderQuery,
} = storefrontApi;
