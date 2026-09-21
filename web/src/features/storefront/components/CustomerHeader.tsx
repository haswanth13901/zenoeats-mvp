import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Icon } from "@/components/common/icons";
import { selectCartCount } from "@/features/cart/cartSlice";
import type { Portal } from "@/types";

/**
 * The restaurant's own header on every customer page (revision 06).
 *
 * The wordmark is the restaurant's name, set in the storefront's type with a
 * monogram of its first letter -- never a substituted logo, because there is
 * no logo field to take one from. It always leads back to the menu.
 *
 * On the menu the header also carries the page's jump links and the order
 * button; through checkout, payment and tracking it is quieter and says only
 * who the customer is ordering from, so nothing competes with the task.
 */
export function CustomerHeader({
  restaurant,
  links,
  showOrder = false,
}: {
  restaurant: Pick<Portal, "name" | "delivery_offered" | "is_orderable" | "accepting_orders" | "storefront">;
  /** Jump links into the page. Hidden on a phone, where the category row
   *  below does the same job. */
  links?: ReactNode;
  showOrder?: boolean;
}) {
  return (
    <header className="border-b border-[#E6E5DB] bg-cream">
      <div className="mx-auto flex min-h-[72px] max-w-[1336px] items-center gap-[15px] px-[19px] sm:min-h-[78px] sm:gap-[25px] sm:px-7 lg:min-h-[88px] lg:gap-[30px] xl:gap-[50px] xl:px-10">
        {restaurant.storefront?.logo_url ? <Link to="/" aria-label={`${restaurant.name}, back to the menu`}><img src={restaurant.storefront.logo_url} alt={restaurant.name} className="max-h-14 max-w-[180px] object-contain" /></Link> : <Wordmark name={restaurant.name} />}
        {links && (
          <nav className="hidden items-center gap-5 sm:flex lg:gap-7" aria-label="On this page">
            {links}
          </nav>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-5">
          {showOrder ? (
            <>
              <span className="hidden items-center gap-[7px] text-caption text-[#637365] xl:flex">
                <Icon name="store" className="h-[17px] w-[17px]" />
                {restaurant.delivery_offered ? "Pick-up & delivery" : "Pick-up"}
              </span>
              <OrderButton orderable={restaurant.is_orderable && restaurant.accepting_orders} />
            </>
          ) : (
            <span className="hidden items-center gap-[7px] text-caption text-[#637365] sm:flex">
              <Icon name="lock" className="h-[17px] w-[17px]" />
              <span className="truncate">Order directly with {restaurant.name}</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function Wordmark({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <Link
      to="/"
      className="inline-flex min-w-0 items-center gap-2 text-brick no-underline sm:gap-[11px]"
      aria-label={`${name}, back to the menu`}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-[35px] w-[33px] shrink-0 items-center justify-center rounded-[9px_9px_9px_2px] bg-brick pr-[3px] font-display text-[26px] font-bold italic leading-none text-gold sm:h-[43px] sm:w-[41px] sm:rounded-[11px_11px_11px_2px] sm:text-[31px]"
      >
        {initial}
      </span>
      <span
        aria-hidden="true"
        className="truncate font-display text-[23px] font-bold leading-[1.1] tracking-[-1px] sm:text-[25px] lg:text-[29px] lg:tracking-[-1.4px]"
      >
        {name}
        <span className="text-accent">.</span>
      </span>
    </Link>
  );
}

/**
 * The cart, from the header. The same cart and the same rules as the sticky
 * bar at the foot of the menu: nothing to review when it is empty, and not
 * reviewable while the restaurant is not taking orders.
 */
function OrderButton({ orderable }: { orderable: boolean }) {
  const count = useAppSelector(selectCartCount);
  const label = `Review order, ${count} ${count === 1 ? "item" : "items"}`;
  const inner = (
    <>
      <Icon name="bag" className="h-[17px] w-[17px] sm:h-5 sm:w-5" />
      <span className="hidden sm:inline">Your order</span>
      <b className="tnum inline-grid h-5 min-w-[20px] place-items-center rounded-full bg-white/15 px-1 text-[11px] sm:h-[22px] sm:min-w-[22px]">
        {count}
      </b>
    </>
  );
  const shape =
    "inline-flex min-h-[44px] shrink-0 items-center gap-[7px] rounded-full border px-2.5 text-caption font-semibold sm:gap-2.5 sm:px-[17px]";

  if (count === 0 || !orderable) {
    return (
      <span
        className={`${shape} border-[#DCE2D5] bg-[#EBEFE6] text-[#647061] [&_b]:bg-surface`}
        aria-label={count === 0 ? "Your order is empty" : `${label}. Not taking orders right now.`}
        role="img"
      >
        {inner}
      </span>
    );
  }
  return (
    <Link
      to="/checkout"
      aria-label={label}
      className={`${shape} border-brick bg-brick text-white transition-colors duration-color ease-standard hover:bg-brickDark`}
    >
      {inner}
    </Link>
  );
}
