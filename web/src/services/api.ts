import { createApi, type BaseQueryFn } from "@reduxjs/toolkit/query/react";
import { ApiError, request, type RequestOptions } from "./apiClient";
import { getCustomerToken } from "./clerk";

export type QueryArgs = {
  url: string;
  method?: string;
  body?: unknown;
  /** Send the signed-in customer's Clerk session token. Fetched per request,
   *  because Clerk's tokens last about a minute and Clerk refreshes them. */
  customerAuth?: boolean;
  idempotencyKey?: string;
};

/**
 * RTK Query over the existing client rather than fetchBaseQuery.
 *
 * fetchBaseQuery would mean two request paths with two sets of behaviour. The
 * timeout, the abort linking and the normalisation of every failure into an
 * ApiError with a real `code` all live in apiClient, and the vanilla login
 * pages use it too -- so reusing it keeps one definition of what a request is.
 */
const baseQuery: BaseQueryFn<QueryArgs | string, unknown, ApiError> = async (
  args,
  api,
) => {
  const opts: QueryArgs = typeof args === "string" ? { url: args } : args;
  try {
    const token = opts.customerAuth ? await getCustomerToken() : undefined;
    const data = await request<unknown>(opts.url, {
      method: opts.method,
      body: opts.body,
      token,
      idempotencyKey: opts.idempotencyKey,
      // RTK Query aborts on unmount and on refetch; passing its signal through
      // is what makes a superseded request stop rather than land late.
      signal: api.signal,
    } satisfies RequestOptions);
    return { data };
  } catch (e) {
    if (e instanceof ApiError) return { error: e };
    // A caller-initiated abort. RTK Query discards the result either way; the
    // shape just has to be an error.
    return { error: new ApiError(0, "ABORTED", "Request cancelled.") };
  }
};

/**
 * Tags are what make mutations refresh the right screens. Creating a
 * restaurant invalidates the list without any page needing to know it should
 * refetch, which is the behaviour the hand-rolled hooks did not have.
 */
export const api = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: [
    "Restaurant",
    "AdminOrder",
    "AdminReport",
    "Portal",
    "Menu",
    "Item",
    "ItemType",
    "Combo",
    "ModifierGroup",
    "Board",
    "Staff",
    "RestaurantReport",
    "Order",
    "Session",
  ],
  endpoints: () => ({}),
});
