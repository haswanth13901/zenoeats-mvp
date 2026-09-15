import { api } from "@/services/api";
import { request } from "@/services/apiClient";
import type { DiscountKind, Meal } from "@/types";

export type StaffMe = {
  user_id: string;
  email: string;
  full_name: string | null;
  role_code: string;
  must_change_password: boolean;
  /** Which restaurant this session is scoped to. The portal header shows it. */
  restaurant_name: string;
  /** INVITED until the person accepts from inside the portal. Every staff
   *  endpoint but accepting refuses an invited session. */
  membership_status: "ACTIVE" | "INVITED";
};

export type StaffInvite = {
  id: string;
  email: string;
  status: string;
  /** Present only when the invitation created the person's login. Shown once;
   *  the API keeps only its hash. */
  temporary_password: string | null;
};

export type BoardOrder = {
  order_id: string;
  order_number: number;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  /** When payment put it on the board: where the kitchen's clock starts. */
  paid_at: string | null;
  customer_note: string | null;
  /** PAID, or REFUNDED / PARTIALLY_REFUNDED after a refund from the Stripe
   *  Dashboard. A refund never moves the order itself, so this is how the
   *  board knows to say so. */
  payment_status: string | null;
  /** Five wrong PINs. Only a manager override can hand it over now. */
  pin_locked: boolean;
  items: {
    name: string;
    quantity: number;
    note: string | null;
    modifiers: string[];
    /** Set on the lines a combo produced. Lines sharing a group number are
     *  one meal deal and are plated together. */
    combo_name: string | null;
    combo_group: number | null;
  }[];
};

/** An order that left the board today: handed over or cancelled. */
export type HistoryOrder = {
  order_id: string;
  order_number: number;
  status: "COMPLETED" | "CANCELLED";
  total_minor: number;
  currency: string;
  paid_at: string | null;
  finished_at: string;
  payment_status: string | null;
  items: { name: string; quantity: number; combo_name: string | null }[];
  /** The last staff action on it, from the order's history. Null for an order
   *  finished before that history was kept. */
  last_action: {
    action: "MARKED_READY" | "COMPLETED_WITH_PIN" | "COMPLETED_BY_OVERRIDE" | "CANCELLED";
    by: string | null;
    reason: string | null;
  } | null;
};

export type OrderHistory = {
  /** Today where the restaurant is. */
  date: string;
  timezone: string;
  orders: HistoryOrder[];
};

/** Cancelling never moves money; refund_needed says the refund is still to
 *  be issued from the restaurant's Stripe Dashboard. */
export type CancelledOrder = {
  order_id: string;
  status: string;
  payment_status: string;
  refund_needed: boolean;
};

/** Shown once to the admin who reset it; only its hash is kept. */
export type StaffPasswordReset = {
  id: string;
  email: string;
  temporary_password: string;
};

export type StaffMember = {
  id: string;
  email: string;
  full_name: string | null;
  role_code: string;
  status: string;
  invited_at: string | null;
  accepted_at: string | null;
  /** The signed-in admin's own row. Removing yourself is refused. */
  is_you: boolean;
};

/**
 * One row of the item library.
 *
 * Not the same shape as an item inside /menu. That one is arranged for
 * reading a menu and carries whole modifier groups with their options; this
 * one is arranged for editing and carries the ids the forms bind to -- which
 * periods serve it, which groups it offers.
 */
export type LibraryItem = {
  id: string;
  name: string;
  item_type_id: string;
  description: string | null;
  base_price_minor: number;
  currency: string;
  is_available: boolean;
  /** The storage key, sent back unchanged when an edit leaves the photo
   *  alone, and null when there is none. */
  image_path: string | null;
  /** Where the thumbnail loads from. */
  image_url: string | null;
  meal_ids: string[];
  modifier_groups: { id: string; name: string }[];
  /** What the item comes with: chosen for the customer, and charged at
   *  nothing on this item. */
  included_option_ids: string[];
};

/** The fields an item form owns. Every one is optional on an edit. */
export type ItemDraft = {
  name: string;
  item_type_id: string;
  description: string | null;
  base_price_minor: number;
  modifier_group_ids: string[];
  meal_ids: string[];
  included_option_ids: string[];
  /** A key from uploadImage, or null to take the photo off. */
  image_path: string | null;
};

/** A combo as the builder edits it: ids to bind to, not a priced menu.
 *
 *  The storefront reads combos out of /menu instead, arranged for ordering
 *  and carrying whole items with their modifier groups. Same two shapes as
 *  items, for the same reason. */
export type BuilderCombo = {
  id: string;
  meal_id: string;
  name: string;
  description: string | null;
  discount_kind: DiscountKind;
  discount_value: number;
  is_available: boolean;
  slots: { id: string; item_type_id: string; item_ids: string[] }[];
};

/** A slot as it is sent. One per kind, and never empty: a kind with nothing
 *  ticked is a kind the combo does not include. */
export type ComboSlotDraft = { item_type_id: string; item_ids: string[] };

/** An item as the sold-out screen needs it, and nothing more. */
export type StockItem = {
  id: string;
  name: string;
  /** The type's name, with its heading when it is a subcategory. */
  type: string;
  is_available: boolean;
};

/** One of the restaurant's item types, with how many items would be
 *  orphaned by deleting it.
 *
 *  The list arrives flat but in the order the menu reads: every heading is
 *  followed by its own subcategories. `parent_id` is what tells them apart,
 *  and it is null on a heading, which is most of them.
 *
 *  `items` is the direct count, never rolled up. It is the number the
 *  deletion rule reads, so a heading with nothing filed on it reports zero
 *  even when its subcategories are full. */
export type ItemTypeRow = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  items: number;
};

/** What a group edit may send. Only what changed is sent; the server checks the
 *  rules it adds up to against the group's options and the items using it. */
export type ModifierGroupChanges = {
  name?: string;
  applies_to_type_ids?: string[];
  selection_type?: "SINGLE" | "MULTI";
  is_required?: boolean;
  min_select?: number;
  max_select?: number;
};

export type ModifierGroupSummary = {
  id: string;
  name: string;
  selection_type: "SINGLE" | "MULTI";
  is_required: boolean;
  min_select: number;
  max_select: number;
  /** Which item kinds the builder offers this group for. Empty means every
   *  kind -- there is no null case, so no call site tests for one. */
  applies_to_type_ids: string[];
  options: {
    id: string;
    name: string;
    price_delta_minor: number;
    image_path: string | null;
    image_url: string | null;
  }[];
};

/** What a photo is of. Part of where it is stored, and checked when it is
 *  attached: an option's thumbnail cannot be saved onto an item. */
export type ImageKind = "items" | "options";

/** A stored photo that nothing shows yet. Saving an item or option with the
 *  key is what puts it on the menu. */
export type UploadedImage = { image_path: string; image_url: string };

/** Photos are larger than anything else this portal sends, over whatever
 *  connection a manager has in the kitchen. */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Store a photo and get its key back.
 *
 * A plain request rather than an RTK Query mutation. A mutation's arguments
 * are kept in the store, and a Blob there trips Redux's serializability check
 * on every upload; nothing needs caching or invalidating here anyway, because
 * nothing on screen changes until the item or option holding the key is
 * saved, and that save invalidates what it should.
 */
export function uploadImage(kind: ImageKind, file: Blob, filename: string) {
  const body = new FormData();
  body.append("file", file, filename);
  return request<UploadedImage>(`/restaurant/images?kind=${kind}`, {
    method: "POST",
    body,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

/** A range of the restaurant's own days, as YYYY-MM-DD, both inclusive.
 *  Left out, the report is for today where the restaurant is. */
export type ReportRange = { from?: string; to?: string };

export type RestaurantReport = {
  currency: string;
  /** The restaurant's timezone, which decides where each day starts. */
  timezone: string;
  /** Today's date there, so the page can offer "yesterday" and "this month"
   *  without trusting the browser's clock or timezone. */
  today: string;
  from: string;
  to: string;
  orders_paid: number;
  orders_completed: number;
  orders_cancelled: number;
  orders_refunded: number;
  /** What was taken, before refunds. */
  gross_sales_minor: number;
  /** What has since been refunded on those same orders. */
  refunds_minor: number;
  net_sales_minor: number;
  /** Net of the tax returned with refunds. */
  tax_collected_minor: number;
  combo_discounts_minor: number;
  average_order_value_minor: number;
  /** Right now, whatever the range. */
  orders_pending_payment: number;
  orders_expired: number;
  by_day: {
    date: string;
    orders: number;
    gross_minor: number;
    refunds_minor: number;
    net_minor: number;
  }[];
  top_items: { name: string; units: number; revenue_minor: number }[];
};

/**
 * The restaurant portal.
 *
 * Which restaurant this is never appears in a request: the API resolves it
 * from the Host header of the subdomain the page was served on, and
 * restaurant_users under RLS decides what the caller may do. So these
 * endpoints carry no tenant id, and a session presented on another
 * restaurant's subdomain simply finds no membership.
 */
export const restaurantApi = api.injectEndpoints({
  endpoints: (build) => ({
    staffMe: build.query<StaffMe, void>({
      query: () => ({ url: "/restaurant/me" }),
      providesTags: ["Session"],
    }),

    staffLogout: build.mutation<void, void>({
      query: () => ({ url: "/restaurant/logout", method: "POST" }),
      invalidatesTags: ["Session"],
    }),

    // Every session this account holds, on every device -- not just this one.
    staffLogoutEverywhere: build.mutation<void, void>({
      query: () => ({ url: "/restaurant/logout-everywhere", method: "POST" }),
      invalidatesTags: ["Session"],
    }),

    orderBoard: build.query<BoardOrder[], void>({
      query: () => ({ url: "/restaurant/orders" }),
      providesTags: ["Board"],
    }),

    // Tagged with the board, so handing over or cancelling moves an order
    // from one list to the other in the same refresh.
    orderHistory: build.query<OrderHistory, void>({
      query: () => ({ url: "/restaurant/orders/history" }),
      providesTags: ["Board"],
    }),

    markReady: build.mutation<unknown, string>({
      query: (orderId) => ({ url: `/restaurant/orders/${orderId}/ready`, method: "POST" }),
      invalidatesTags: ["Board"],
    }),

    completeOrder: build.mutation<unknown, { orderId: string; pin: string }>({
      query: ({ orderId, pin }) => ({
        // In the body, not the query string: URLs are written to access logs.
        url: `/restaurant/orders/${orderId}/complete`,
        method: "POST",
        body: { pin },
      }),
      // Completing an order moves it off the board and into the day's takings.
      invalidatesTags: ["Board", "RestaurantReport"],
    }),

    overrideComplete: build.mutation<unknown, { orderId: string; reason: string }>({
      query: ({ orderId, reason }) => ({
        url: `/restaurant/orders/${orderId}/override-complete`,
        method: "POST",
        body: { reason },
      }),
      invalidatesTags: ["Board", "RestaurantReport"],
    }),

    cancelOrder: build.mutation<CancelledOrder, { orderId: string; reason: string }>({
      query: ({ orderId, reason }) => ({
        url: `/restaurant/orders/${orderId}/cancel`,
        method: "POST",
        body: { reason },
      }),
      invalidatesTags: ["Board", "RestaurantReport"],
    }),

    // The builder's view, not the storefront's. /menu answers only for an
    // ACTIVE restaurant and hides meal periods that are still empty, so a
    // draft saw nothing at all and everyone else saw a new period vanish the
    // moment it was created.
    menu: build.query<{ meals: Meal[] }, void>({
      query: () => ({ url: "/restaurant/menu" }),
      providesTags: ["Menu"],
    }),

    // Every item the restaurant sells, whether or not a period serves it.
    // The Items tab writes this list; the meal periods tab arranges it.
    itemTypes: build.query<ItemTypeRow[], void>({
      query: () => ({ url: "/restaurant/item-types" }),
      providesTags: ["ItemType"],
    }),

    createItemType: build.mutation<
      unknown,
      { name: string; parent_id?: string | null; sort_order?: number }
    >({
      query: (body) => ({ url: "/restaurant/item-types", method: "POST", body }),
      invalidatesTags: ["ItemType"],
    }),

    // Renaming a type changes a heading on the storefront and the words the
    // item forms offer, so the menu and the item library are re-read too.
    // parent_id is only sent when it is meant to change. The server applies
    // what it is sent and nothing else, which is what makes an explicit null
    // mean "promote this back to a heading of its own".
    updateItemType: build.mutation<
      unknown,
      {
        typeId: string;
        changes: { name?: string; parent_id?: string | null; sort_order?: number };
      }
    >({
      query: ({ typeId, changes }) => ({
        url: `/restaurant/item-types/${typeId}`,
        method: "PATCH",
        body: changes,
      }),
      invalidatesTags: ["ItemType", "Menu", "Item", "Combo", "ModifierGroup"],
    }),

    // Refused by the server while items still carry it, which is why the
    // combo and modifier lists only need re-reading on success.
    deleteItemType: build.mutation<unknown, string>({
      query: (typeId) => ({ url: `/restaurant/item-types/${typeId}`, method: "DELETE" }),
      invalidatesTags: ["ItemType", "Menu", "Item", "Combo", "ModifierGroup"],
    }),

    items: build.query<LibraryItem[], void>({
      query: () => ({ url: "/restaurant/items" }),
      providesTags: ["Item"],
    }),

    modifierGroups: build.query<ModifierGroupSummary[], void>({
      query: () => ({ url: "/restaurant/modifier-groups" }),
      providesTags: ["ModifierGroup"],
    }),

    createMeal: build.mutation<unknown, { name: string; sort_order?: number }>({
      query: (body) => ({ url: "/restaurant/meals", method: "POST", body }),
      invalidatesTags: ["Menu"],
    }),

    // Partial, like every other update in this builder: only the keys sent
    // are applied. Clearing the hours is sending both as null, which is why
    // they are typed as nullable rather than merely optional -- leaving them
    // out means "don't touch them" and would make clearing impossible.
    updateMeal: build.mutation<
      unknown,
      {
        mealId: string;
        changes: {
          name?: string;
          starts_at?: string | null;
          ends_at?: string | null;
        };
      }
    >({
      query: ({ mealId, changes }) => ({
        url: `/restaurant/meals/${mealId}`,
        method: "PATCH",
        body: changes,
      }),
      invalidatesTags: ["Menu"],
    }),

    // Soft delete on the server: the row stays so paid orders keep resolving,
    // and the menu reader stops returning it. The items the period served are
    // kept -- they belong to the restaurant, not to the period -- but every
    // library row loses a meal id, so both lists are re-read.
    deleteMeal: build.mutation<unknown, string>({
      query: (mealId) => ({ url: `/restaurant/meals/${mealId}`, method: "DELETE" }),
      invalidatesTags: ["Menu", "Item"],
    }),

    // Pull existing items onto a period.
    addMealItems: build.mutation<unknown, { mealId: string; item_ids: string[] }>({
      query: ({ mealId, item_ids }) => ({
        url: `/restaurant/meals/${mealId}/items`,
        method: "POST",
        body: { item_ids },
      }),
      invalidatesTags: ["Menu", "Item"],
    }),

    // Stop serving one item during one period. The item survives, as does
    // every other period serving it.
    removeMealItem: build.mutation<unknown, { mealId: string; itemId: string }>({
      query: ({ mealId, itemId }) => ({
        url: `/restaurant/meals/${mealId}/items/${itemId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Menu", "Item"],
    }),

    // ItemType as well as Item: the type strip shows a count per type, and a
    // new item changes one of them.
    createItem: build.mutation<unknown, Partial<ItemDraft> & { name: string }>({
      query: (body) => ({ url: "/restaurant/items", method: "POST", body }),
      invalidatesTags: ["Item", "ItemType", "Menu"],
    }),

    // Partial: only the fields sent are touched, so editing a price leaves
    // the description alone. meal_ids and modifier_group_ids are whole lists
    // when sent -- the server replaces the set rather than merging into it.
    updateItem: build.mutation<unknown, { itemId: string; changes: Partial<ItemDraft> }>({
      query: ({ itemId, changes }) => ({
        url: `/restaurant/items/${itemId}`,
        method: "PATCH",
        body: changes,
      }),
      // Retyping an item moves it between two counts, so the strip is stale
      // in two places until it is re-read.
      invalidatesTags: ["Item", "ItemType", "Menu"],
    }),

    // Reaches every period at once, which is the point of one item having
    // one definition.
    deleteItem: build.mutation<unknown, string>({
      query: (itemId) => ({ url: `/restaurant/items/${itemId}`, method: "DELETE" }),
      invalidatesTags: ["Item", "ItemType", "Menu"],
    }),

    // Every staff role may read this; /items is managers only. Tagged Item so
    // a toggle here or an edit in the menu builder refreshes both screens.
    stock: build.query<StockItem[], void>({
      query: () => ({ url: "/restaurant/stock" }),
      providesTags: ["Item"],
    }),

    setItemAvailability: build.mutation<unknown, { itemId: string; is_available: boolean }>({
      // is_available is a query parameter, not a body. FastAPI treats a bare
      // bool argument as a query param, so sending it as JSON would leave the
      // endpoint with a missing required parameter.
      query: ({ itemId, is_available }) => ({
        url: `/restaurant/items/${itemId}/availability?is_available=${is_available}`,
        method: "PATCH",
      }),
      invalidatesTags: ["Item", "Menu"],
    }),

    combos: build.query<BuilderCombo[], void>({
      query: () => ({ url: "/restaurant/combos" }),
      providesTags: ["Combo"],
    }),

    createCombo: build.mutation<
      unknown,
      {
        meal_id: string;
        name: string;
        description?: string | null;
        discount_kind: DiscountKind;
        discount_value: number;
        slots: ComboSlotDraft[];
      }
    >({
      query: (body) => ({ url: "/restaurant/combos", method: "POST", body }),
      // The storefront menu carries combos, so it is re-read too.
      invalidatesTags: ["Combo", "Menu"],
    }),

    // Partial, like the others. Sending `slots` replaces every slot and
    // choice: the builder always knows the whole combo it means, and a merge
    // cannot express taking the last drink out of a slot.
    updateCombo: build.mutation<
      unknown,
      {
        comboId: string;
        changes: {
          name?: string;
          description?: string | null;
          discount_kind?: DiscountKind;
          discount_value?: number;
          is_available?: boolean;
          slots?: ComboSlotDraft[];
        };
      }
    >({
      query: ({ comboId, changes }) => ({
        url: `/restaurant/combos/${comboId}`,
        method: "PATCH",
        body: changes,
      }),
      invalidatesTags: ["Combo", "Menu"],
    }),

    deleteCombo: build.mutation<unknown, string>({
      query: (comboId) => ({ url: `/restaurant/combos/${comboId}`, method: "DELETE" }),
      invalidatesTags: ["Combo", "Menu"],
    }),

    createModifierGroup: build.mutation<unknown, Record<string, unknown>>({
      query: (body) => ({ url: "/restaurant/modifier-groups", method: "POST", body }),
      invalidatesTags: ["ModifierGroup"],
    }),

    // Partial: only the fields sent are touched. applies_to_type_ids is a whole
    // list when sent, and an empty one is a real value meaning "offer this
    // everywhere" -- so it must not be dropped from the body when empty.
    updateModifierGroup: build.mutation<
      unknown,
      { groupId: string; changes: ModifierGroupChanges }
    >({
      query: ({ groupId, changes }) => ({
        url: `/restaurant/modifier-groups/${groupId}`,
        method: "PATCH",
        body: changes,
      }),
      // The kinds decide which items are offered the group, so the item forms
      // re-read too.
      invalidatesTags: ["ModifierGroup", "Item", "Menu"],
    }),

    // A group is attached to items, so the menu has to be re-read too: every
    // item that opted in stops offering it the moment it goes.
    deleteModifierGroup: build.mutation<unknown, string>({
      query: (groupId) => ({
        url: `/restaurant/modifier-groups/${groupId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["ModifierGroup", "Menu"],
    }),

    createModifierOption: build.mutation<
      unknown,
      {
        groupId: string;
        name: string;
        price_delta_minor: number;
        image_path?: string | null;
      }
    >({
      query: ({ groupId, ...body }) => ({
        url: `/restaurant/modifier-groups/${groupId}/options`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["ModifierGroup", "Menu"],
    }),

    // image_path follows the partial rule: null takes the photo off, and
    // leaving it out leaves the photo alone.
    updateModifierOption: build.mutation<
      unknown,
      {
        optionId: string;
        changes: { name?: string; price_delta_minor?: number; image_path?: string | null };
      }
    >({
      query: ({ optionId, changes }) => ({
        url: `/restaurant/modifier-options/${optionId}`,
        method: "PATCH",
        body: changes,
      }),
      invalidatesTags: ["ModifierGroup", "Menu"],
    }),

    deleteModifierOption: build.mutation<unknown, string>({
      query: (optionId) => ({
        url: `/restaurant/modifier-options/${optionId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["ModifierGroup", "Menu"],
    }),

    staff: build.query<StaffMember[], void>({
      query: () => ({ url: "/restaurant/staff" }),
      providesTags: ["Staff"],
    }),

    inviteStaff: build.mutation<StaffInvite, { email: string; role_code: string }>({
      query: (body) => ({ url: "/restaurant/staff", method: "POST", body }),
      invalidatesTags: ["Staff"],
    }),

    acceptInvitation: build.mutation<unknown, void>({
      query: () => ({ url: "/restaurant/staff/accept", method: "POST" }),
      // The session's membership changes from INVITED to ACTIVE, which is
      // what the guard reads to decide between the invitation and the portal.
      invalidatesTags: ["Session", "Staff"],
    }),

    changeStaffRole: build.mutation<unknown, { membershipId: string; role_code: string }>({
      query: ({ membershipId, role_code }) => ({
        url: `/restaurant/staff/${membershipId}`,
        method: "PATCH",
        body: { role_code },
      }),
      invalidatesTags: ["Staff"],
    }),

    resetStaffPassword: build.mutation<StaffPasswordReset, string>({
      query: (membershipId) => ({
        url: `/restaurant/staff/${membershipId}/reset-password`,
        method: "POST",
      }),
    }),

    revokeStaff: build.mutation<unknown, string>({
      query: (membershipId) => ({
        url: `/restaurant/staff/${membershipId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Staff"],
    }),

    restaurantReports: build.query<RestaurantReport, ReportRange>({
      query: ({ from, to }) => {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const qs = params.toString();
        return { url: `/restaurant/reports${qs ? `?${qs}` : ""}` };
      },
      providesTags: ["RestaurantReport"],
    }),
  }),
});

export const {
  useStaffMeQuery,
  useStaffLogoutMutation,
  useStaffLogoutEverywhereMutation,
  useOrderBoardQuery,
  useOrderHistoryQuery,
  useMarkReadyMutation,
  useCompleteOrderMutation,
  useOverrideCompleteMutation,
  useCancelOrderMutation,
  useMenuQuery,
  useItemTypesQuery,
  useCreateItemTypeMutation,
  useUpdateItemTypeMutation,
  useDeleteItemTypeMutation,
  useItemsQuery,
  useModifierGroupsQuery,
  useCreateMealMutation,
  useCreateItemMutation,
  useUpdateMealMutation,
  useUpdateItemMutation,
  useDeleteMealMutation,
  useDeleteItemMutation,
  useAddMealItemsMutation,
  useRemoveMealItemMutation,
  useCombosQuery,
  useCreateComboMutation,
  useUpdateComboMutation,
  useDeleteComboMutation,
  useSetItemAvailabilityMutation,
  useStockQuery,
  useCreateModifierGroupMutation,
  useUpdateModifierGroupMutation,
  useDeleteModifierGroupMutation,
  useCreateModifierOptionMutation,
  useUpdateModifierOptionMutation,
  useDeleteModifierOptionMutation,
  useStaffQuery,
  useInviteStaffMutation,
  useAcceptInvitationMutation,
  useRevokeStaffMutation,
  useChangeStaffRoleMutation,
  useResetStaffPasswordMutation,
  useRestaurantReportsQuery,
} = restaurantApi;
