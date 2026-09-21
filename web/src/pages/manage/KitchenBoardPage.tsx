import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Empty, ErrorNote, Loading, Notice, Spinner } from "@/components/common/Feedback";
import { Icon } from "@/components/common/icons";
import { PageTitle } from "@/components/layout/Shell";
import { BoardColumn } from "@/features/restaurant/components/BoardColumn";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useAssignDriverMutation,
  useCancelOrderMutation,
  useCompleteOrderMutation,
  useMarkReadyMutation,
  useOrderBoardQuery,
  useDriversQuery,
  useUnassignDriverMutation,
  useOrderHistoryQuery,
  useOverrideCompleteMutation,
  type BoardOrder,
  type HistoryOrder,
} from "@/features/restaurant/restaurantApi";
import { useNewOrderAlert } from "@/features/restaurant/newOrderAlert";
import { canActOnOrders, canManage as roleCanManage } from "@/features/restaurant/nav";
import { selectSession } from "@/features/session/sessionSlice";
import { ApiError, errorMessage } from "@/services/apiClient";

type Acting = { orderId: string; kind: "override" | "cancel" | "assign" | "unassign" };

/** The board's heading, by who is looking at it. The page is the same for
 *  every floor role; what they came to it for is not. */
const HEADINGS: Record<string, { title: string; subtitle: string }> = {
  ADMIN: { title: "Restaurant operations", subtitle: "Orders, deliveries and the team, in one place." },
  MANAGER: { title: "Service overview", subtitle: "Keep service moving, from kitchen to collection." },
  CASHIER: { title: "At the counter", subtitle: "Ready orders and PIN collection." },
  KITCHEN: { title: "On the pass", subtitle: "Clear tickets. Calm service." },
  IT_SUPPORT: { title: "Service, as it stands", subtitle: "What the restaurant is working through. Read only." },
};

/** Past this, a collection is late and the ticket says so. */
const OVERDUE_MINUTES = 15;

export function KitchenBoardPage() {
  // Polling stands in for WebSockets at MVP volume. Five seconds is well inside
  // the time it takes to read a new ticket. RTK Query supersedes an in-flight
  // request rather than stacking them, so a slow API cannot pile up work.
  const board = useOrderBoardQuery(undefined, { pollingInterval: 5_000 });
  // RTK Query keeps the same array while nothing changed, so this only
  // recomputes when the board does.
  const orderIds = useMemo(() => board.data?.map((o) => o.order_id), [board.data]);
  const alert = useNewOrderAlert(orderIds);
  const [markReady] = useMarkReadyMutation();
  const [completeOrder] = useCompleteOrderMutation();
  const [overrideComplete] = useOverrideCompleteMutation();
  const [cancelOrder] = useCancelOrderMutation();
  const [assignDriver] = useAssignDriverMutation();
  const [unassignDriver] = useUnassignDriverMutation();
  const { roleCode } = useAppSelector(selectSession);
  // Override and cancel are managers only. The server decides regardless;
  // this only avoids offering a button that would 403.
  const canManage = roleCanManage(roleCode);
  // IT support reads this board to see what the restaurant is working
  // through, and moves nothing on it. Without this the role would be shown
  // "Mark ready" and "Collect with PIN" on every ticket and be refused by the
  // API on both -- the board's two buttons are the floor's, not support's.
  const canAct = canActOnOrders(roleCode);

  const [error, setError] = useState<string | null>(null);
  // A failure from the form open on one ticket, shown inside that form so the
  // draft and its reason for failing sit together.
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  // One manager action open at a time, on one ticket, with the reason being
  // typed for it. Opening one closes the PIN box, and the other way round.
  const [acting, setActing] = useState<Acting | null>(null);
  const [reason, setReason] = useState("");

  function clearMessages() {
    setError(null);
    setFormError(null);
    setNotice(null);
  }

  function openAction(orderId: string, kind: Acting["kind"]) {
    clearMessages();
    setPinFor(null);
    setReason("");
    setActing({ orderId, kind });
  }

  function closeAction() {
    setActing(null);
    setFormError(null);
  }

  async function ready(id: string) {
    setBusy(id);
    clearMessages();
    try {
      await markReady(id).unwrap();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function complete(id: string) {
    setBusy(id);
    clearMessages();
    try {
      await completeOrder({ orderId: id, pin: pin.trim() }).unwrap();
      setPinFor(null);
      setPin("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "PIN_LOCKED") {
        // The ticket turns into its locked state on the next poll; the PIN
        // box would only answer "locked" again.
        setPinFor(null);
        setError(
          canManage
            ? "Five wrong PINs, so this order is locked. You can hand it over without the PIN."
            : "Five wrong PINs, so this order is locked. Ask a manager to hand it over.",
        );
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function confirmAction(order: BoardOrder) {
    if (!acting) return;
    setBusy(order.order_id);
    clearMessages();
    try {
      if (acting.kind === "override") {
        await overrideComplete({ orderId: order.order_id, reason: reason.trim() }).unwrap();
        setNotice({ text: `#${order.order_number} handed over without a PIN.`, tone: "neutral" });
      } else {
        const out = await cancelOrder({ orderId: order.order_id, reason: reason.trim() }).unwrap();
        // The unrefunded case is a money consequence, so it reads as a warning
        // and stays until the next action.
        setNotice(
          out.refund_needed
            ? {
                text: `#${order.order_number} cancelled. The customer has not been refunded: issue the refund from your Stripe Dashboard.`,
                tone: "warning",
              }
            : { text: `#${order.order_number} cancelled. Its payment was already refunded.`, tone: "neutral" },
        );
      }
      setActing(null);
      setReason("");
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** Undo a delivery: the customer is collecting after all. */
  async function backToCollection(order: BoardOrder) {
    setBusy(order.order_id);
    clearMessages();
    try {
      await unassignDriver(order.order_id).unwrap();
      setNotice({ text: `#${order.order_number} is a collection again.`, tone: "neutral" });
      setActing(null);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const orders = board.data ?? [];
  const cooking = ["AUTO_ACCEPTED", "PREPARING"];
  const preparing = orders.filter((o) => cooking.includes(o.status));
  // Ready: at the counter for a collection, with or waiting for a driver on a
  // delivery. One column, because to the kitchen they are all "done, gone soon".
  const waiting = orders.filter((o) => !cooking.includes(o.status));

  /** The form for whichever manager action is open on this ticket. */
  function actionFor(order: BoardOrder): ReactNode {
    if (acting?.orderId !== order.order_id) return null;
    const isBusy = busy === order.order_id;
    if (acting.kind === "assign") {
      return (
        <AssignDriverForm
          order={order}
          busy={isBusy}
          error={formError}
          canInvite={roleCode === "ADMIN"}
          onBack={closeAction}
          onAssign={async (membership_id, delivery_address) => {
            setBusy(order.order_id);
            clearMessages();
            try {
              const out = await assignDriver({
                orderId: order.order_id,
                membership_id,
                delivery_address,
              }).unwrap();
              setNotice({ text: `#${order.order_number} is ${out.driver}'s delivery.`, tone: "neutral" });
              setActing(null);
            } catch (e) {
              // The form stays open with its driver and address as typed.
              setFormError(errorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
        />
      );
    }
    if (acting.kind === "unassign") {
      return (
        <div className="inline-confirm">
          <p>
            Make <strong>#{order.order_number}</strong> a collection again? The driver and delivery
            address will be cleared. The customer will collect with their PIN.
          </p>
          <ErrorNote message={formError} className="mt-3" />
          <div className="mt-3.5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn-quiet"
              disabled={isBusy}
              onClick={() => void backToCollection(order)}
            >
              {isBusy ? "Saving…" : "Back to collection"}
            </button>
            <button type="button" className="link" disabled={isBusy} onClick={closeAction}>
              Keep delivery
            </button>
          </div>
        </div>
      );
    }
    return (
      <ReasonForm
        kind={acting.kind}
        order={order}
        reason={reason}
        busy={isBusy}
        error={formError}
        onReason={setReason}
        onConfirm={() => void confirmAction(order)}
        onBack={closeAction}
      />
    );
  }

  const cancelLink = (order: BoardOrder) =>
    canManage && (
      <button type="button" className="link-danger" onClick={() => openAction(order.order_id, "cancel")}>
        cancel order
      </button>
    );

  /** Hand the order to a driver, or hand it to a different one. */
  const driverLink = (order: BoardOrder) =>
    canManage && (
      <button type="button" className="link" onClick={() => openAction(order.order_id, "assign")}>
        {order.fulfillment_type === "DELIVERY" ? "change driver" : "assign driver"}
      </button>
    );

  const managerLinks = (...links: ReactNode[]) =>
    canManage && <div className="mt-[7px] flex flex-wrap gap-x-[18px] gap-y-0">{links}</div>;

  const heading = (roleCode && HEADINGS[roleCode]) || {
    title: "Kitchen & counter",
    subtitle: "Every order, in its place.",
  };

  const soundControl = alert.soundReady ? (
    <button type="button" className="btn-quiet" onClick={alert.disableSound}>
      Sound on for new orders · turn off
    </button>
  ) : (
    <button type="button" className="btn-quiet" onClick={() => void alert.enableSound()}>
      {alert.soundWanted ? "Tap to turn sound back on" : "Turn on sound for new orders"}
    </button>
  );

  const makingColumn = (
    <BoardColumn key="making" title="Making now" count={preparing.length} dot="bg-brick">
      {!preparing.length && <Empty>Nothing in the queue.</Empty>}
      {preparing.map((o) => (
        <Ticket
          key={o.order_id}
          order={o}
          fresh={o.order_id in alert.fresh}
          onSeen={() => alert.acknowledge(o.order_id)}
        >
          {actionFor(o) ?? (
            <>
              {canAct ? (
                <button
                  type="button"
                  className="btn-primary btn-touch w-full"
                  disabled={busy === o.order_id}
                  onClick={() => ready(o.order_id)}
                >
                  {busy === o.order_id && <Spinner />}
                  {o.fulfillment_type === "DELIVERY" ? "Mark ready for the driver" : "Mark ready for pickup"}
                </button>
              ) : (
                <p className="py-3 text-[15px] font-semibold">In the kitchen.</p>
              )}
              {managerLinks(
                <span key="d">{driverLink(o)}</span>,
                <span key="c">{cancelLink(o)}</span>,
              )}
            </>
          )}
        </Ticket>
      ))}
    </BoardColumn>
  );

  const readyColumn = (
    <BoardColumn key="ready" title="Ready" count={waiting.length} dot="bg-success">
      {!waiting.length && <Empty>Nothing ready for the counter or a driver.</Empty>}
      {waiting.map((o) => (
        <Ticket
          key={o.order_id}
          order={o}
          fresh={o.order_id in alert.fresh}
          onSeen={() => alert.acknowledge(o.order_id)}
        >
          {actionFor(o) ??
            (o.fulfillment_type === "DELIVERY" ? (
              // A delivery never offers the PIN box: there is no counter at a
              // doorstep, and the API refuses it.
              <div>
                <p className="py-3 text-[15px] font-semibold">
                  {o.status === "OUT_FOR_DELIVERY"
                    ? `On the road with ${o.driver ?? "a driver"}.`
                    : o.driver
                      ? `Waiting for ${o.driver} to pick it up.`
                      : "Ready, but no driver assigned yet."}
                </p>
                {managerLinks(
                  <span key="d">{driverLink(o)}</span>,
                  // Not once it is on the road: the food has left. Nor when
                  // the customer paid for delivery at checkout -- the API
                  // refuses to keep a delivery fee on a collection.
                  o.status !== "OUT_FOR_DELIVERY" && !o.delivery_fee_minor && (
                    <button
                      key="b"
                      type="button"
                      className="link"
                      disabled={busy === o.order_id}
                      onClick={() => openAction(o.order_id, "unassign")}
                    >
                      back to collection
                    </button>
                  ),
                  <span key="c">{cancelLink(o)}</span>,
                )}
              </div>
            ) : o.pin_locked ? (
              <div>
                <p className="note-error" role="status">
                  Locked after five wrong PINs.
                  {!canManage && " Ask a manager to hand it over."}
                </p>
                {canManage && (
                  <button
                    type="button"
                    className="btn-primary btn-touch mt-3 w-full"
                    onClick={() => openAction(o.order_id, "override")}
                  >
                    Hand over without PIN
                  </button>
                )}
                {managerLinks(<span key="c">{cancelLink(o)}</span>)}
              </div>
            ) : pinFor === o.order_id ? (
              <form
                className="flex animate-reveal flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pin.length === 6 && busy !== o.order_id) void complete(o.order_id);
                }}
              >
                <label className="block">
                  <span className="label">Pickup PIN</span>
                  <input
                    className="field code-input mt-[7px]"
                    value={pin}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    placeholder="······"
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <div className="flex items-center gap-4">
                  <button
                    type="submit"
                    className="btn-primary btn-touch flex-1"
                    disabled={pin.length !== 6 || busy === o.order_id}
                  >
                    {busy === o.order_id && <Spinner />}
                    Hand over
                  </button>
                  <button type="button" className="link" onClick={() => setPinFor(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                {canAct ? (
                  <button
                    type="button"
                    className="btn-quiet btn-touch w-full"
                    onClick={() => {
                      setPinFor(o.order_id);
                      setPin("");
                      setActing(null);
                      clearMessages();
                    }}
                  >
                    Collect with PIN
                  </button>
                ) : (
                  <p className="py-3 text-[15px] font-semibold">
                    Waiting at the counter to be collected.
                  </p>
                )}
                {managerLinks(
                  <span key="d">{driverLink(o)}</span>,
                  <button
                    key="o"
                    type="button"
                    className="link"
                    onClick={() => openAction(o.order_id, "override")}
                  >
                    no PIN? hand over without it
                  </button>,
                  <span key="c">{cancelLink(o)}</span>,
                )}
              </>
            ))}
        </Ticket>
      ))}
    </BoardColumn>
  );

  return (
    <ManageShell>
      <PageTitle title={heading.title} subtitle={heading.subtitle} right={soundControl} />

      <ErrorNote message={error ?? (board.error ? errorMessage(board.error) : null)} />
      {notice && (
        <Notice tone={notice.tone} className="mb-4">
          {notice.text}
        </Notice>
      )}

      {board.isLoading ? (
        <Loading />
      ) : (
        // The counter reads what is ready first; the kitchen reads what it is
        // making. Same two columns, same permissions, different order.
        <div className="mt-6 grid grid-cols-1 gap-7 lg:grid-cols-2">
          {roleCode === "CASHIER" ? [readyColumn, makingColumn] : [makingColumn, readyColumn]}
        </div>
      )}

      <TodayHistory />

      <p className="mt-[22px] max-w-[780px] text-caption text-muted">
        Unpaid orders never reach this board. An order appears only after Stripe
        confirms the payment by webhook.
      </p>
    </ManageShell>
  );
}

/**
 * Give an order to one of the restaurant's drivers, with the address.
 *
 * For a delivery the customer chose at checkout, the address arrives filled
 * in. For a phone order it is typed here, as the restaurant was told it, and
 * assigning is what makes the order a delivery. The same form serves "assign"
 * and "change driver", starting from whatever the order already says.
 */
function AssignDriverForm({
  order,
  busy,
  error,
  canInvite,
  onAssign,
  onBack,
}: {
  order: BoardOrder;
  busy: boolean;
  error: string | null;
  canInvite: boolean;
  onAssign: (membershipId: string, address: string) => void;
  onBack: () => void;
}) {
  const drivers = useDriversQuery();
  const [membershipId, setMembershipId] = useState("");
  const [address, setAddress] = useState(order.delivery_address ?? "");

  const options = drivers.data ?? [];
  const changing = order.fulfillment_type === "DELIVERY";

  return (
    <form
      className="flex animate-disclose flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && membershipId && address.trim().length >= 3) onAssign(membershipId, address.trim());
      }}
    >
      <h4 className="text-[15px] font-semibold">{changing ? "Change driver" : "Assign driver"}</h4>
      <p className="-mt-2 text-caption">
        Send <strong>#{order.order_number}</strong> out with a driver. They see this order and its
        address, and nothing else of the portal.
      </p>
      {drivers.isLoading ? (
        <Loading>Loading drivers…</Loading>
      ) : !options.length ? (
        <div className="note">
          No drivers on the team yet. An admin can invite one from the Staff page.
          {canInvite && (
            <div>
              <Link to="/manage/staff" className="link">
                Invite a driver
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <label className="block">
            <span className="label">Driver</span>
            <select
              className="field mt-[7px]"
              value={membershipId}
              disabled={busy}
              onChange={(e) => setMembershipId(e.target.value)}
            >
              <option value="">Choose a driver…</option>
              {options.map((driver) => (
                <option key={driver.membership_id} value={driver.membership_id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Delivery address, as the customer gave it</span>
            <input
              className="field mt-[7px]"
              value={address}
              maxLength={300}
              disabled={busy}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        </>
      )}
      <ErrorNote message={error} className="" />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="btn-primary btn-touch"
          disabled={busy || !membershipId || address.trim().length < 3}
        >
          {busy && <Spinner />}
          {busy ? "Assigning…" : "Assign"}
        </button>
        <button type="button" className="link" disabled={busy} onClick={onBack}>
          back
        </button>
      </div>
    </form>
  );
}

/**
 * The two things only a manager can do to a ticket, each with the reason it is
 * kept under. Inline on the ticket rather than a dialog: the board is a
 * shared screen, and the ticket being acted on should stay in sight.
 */
function ReasonForm({
  kind,
  order,
  reason,
  busy,
  error,
  onReason,
  onConfirm,
  onBack,
}: {
  kind: "override" | "cancel";
  order: BoardOrder;
  reason: string;
  busy: boolean;
  error: string | null;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const refunded = order.payment_status === "REFUNDED";
  const cancel = kind === "cancel";
  return (
    <form
      className="flex animate-disclose flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && reason.trim().length >= 3) onConfirm();
      }}
    >
      {cancel ? (
        <>
          <p className="text-caption">
            Cancel <strong>#{order.order_number}</strong>.
          </p>
          {refunded ? (
            <p className="note">Its payment has already been refunded.</p>
          ) : (
            <p className="note-warning">
              This does not refund the customer. Issue the refund from your Stripe Dashboard.
            </p>
          )}
        </>
      ) : (
        <p className="text-caption">
          Hand <strong>#{order.order_number}</strong> over without the customer&apos;s PIN. Check it
          is theirs first, by name or their order confirmation. Your name and reason are kept with
          the order.
        </p>
      )}
      <label className="block">
        <span className="label">Reason</span>
        <input
          className="field mt-[7px]"
          value={reason}
          autoFocus
          maxLength={200}
          placeholder={cancel ? "Why? e.g. never collected" : "Why? e.g. phone died, checked name"}
          onChange={(e) => onReason(e.target.value)}
        />
      </label>
      <ErrorNote message={error} className="" />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className={cancel ? "btn-danger" : "btn-primary"}
          disabled={busy || reason.trim().length < 3}
        >
          {busy && <Spinner />}
          {cancel ? "Cancel order" : "Hand over without PIN"}
        </button>
        <button type="button" className="link" disabled={busy} onClick={onBack}>
          back
        </button>
      </div>
    </form>
  );
}

function Ticket({
  order,
  fresh,
  onSeen,
  children,
}: {
  order: BoardOrder;
  fresh?: boolean;
  onSeen?: () => void;
  children: ReactNode;
}) {
  // From payment, which is when the order reached the kitchen. From checkout
  // start, a customer slow at the card step made the ticket look late on
  // arrival.
  const since = order.paid_at ?? order.created_at;
  const waited = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  const late = waited > OVERDUE_MINUTES;
  const refundTag =
    order.payment_status === "REFUNDED"
      ? "refunded"
      : order.payment_status === "PARTIALLY_REFUNDED"
        ? "partly refunded"
        : null;

  return (
    <article
      aria-label={`Order ${order.order_number}`}
      className={`animate-arrive rounded-[13px] bg-surface shadow-card transition-colors duration-color ${
        fresh ? "border-2 border-danger p-[19px] sm:p-[23px]" : "border border-hairline p-5 sm:p-6"
      } ${late ? "border-t-[3px] border-t-danger" : ""}`}
      onClick={onSeen}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[31px] leading-none">#{order.order_number}</span>
          {fresh && <span className="pill-red">new</span>}
          {order.fulfillment_type === "DELIVERY" && <span className="pill-on">delivery</span>}
          {/* A refund in the Stripe Dashboard never moves the order, so this is
              the only sign on the board that nobody is paying for it now. */}
          {refundTag && <span className="pill-red">{refundTag}</span>}
        </div>
        <span className={`whitespace-nowrap text-caption ${late ? "font-[650] text-danger" : "text-muted"}`}>
          {waited < 1 ? "just now" : `${waited} min ago`}
        </span>
      </header>

      <ul className="my-5 flex flex-col gap-[15px] sm:my-6">
        {groupTicket(order.items).map((entry, i) =>
          entry.kind === "combo" ? (
            // One block, indented under the deal's name. Three items listed
            // loose would be plated as three separate orders, and the drink
            // would go out while the burger was still on the grill.
            <li key={i} className="flex gap-3.5">
              <Qty n={entry.quantity} />
              <div className="min-w-0">
                <h4 className="text-base font-semibold sm:text-[17px]">{entry.name}</h4>
                <ul className="mt-[9px] flex flex-col gap-[9px] border-l-2 border-hairline pl-[13px] text-sm">
                  {entry.items.map((item, j) => (
                    <li key={j}>
                      <div>{item.name}</div>
                      {item.modifiers.length > 0 && (
                        <p className="mt-1 text-[13px] text-muted">{item.modifiers.join(" · ")}</p>
                      )}
                      {item.note && <p className="mt-1 text-[13px] text-danger">{item.note}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ) : (
            <li key={i} className="flex gap-3.5">
              <Qty n={entry.item.quantity} />
              <div className="min-w-0">
                <h4 className="text-base font-semibold sm:text-[17px]">{entry.item.name}</h4>
                {entry.item.modifiers.length > 0 && (
                  <p className="mt-1 text-[13px] text-muted">{entry.item.modifiers.join(" · ")}</p>
                )}
                {entry.item.note && <p className="mt-1 text-[13px] text-danger">{entry.item.note}</p>}
              </div>
            </li>
          ),
        )}
      </ul>

      {/* Whose order it is and how to reach them. Absent on orders placed
          before checkout asked. */}
      {order.contact_name && (
        <p className="border-t border-hairline pb-[18px] pt-3.5 text-sm" style={{ overflowWrap: "anywhere" }}>
          <span className="font-semibold">{order.contact_name}</span>
          {order.contact_phone && (
            <>
              {" · "}
              <a className="link link-inline" href={`tel:${order.contact_phone.replace(/[^\d+]/g, "")}`}>
                {order.contact_phone}
              </a>
            </>
          )}
        </p>
      )}

      {order.fulfillment_type === "DELIVERY" && (
        <p className="border-t border-hairline pb-[18px] pt-3.5 text-sm" style={{ overflowWrap: "anywhere" }}>
          {order.delivery_address}
          <span className="text-muted"> · {order.driver ?? "no driver yet"}</span>
        </p>
      )}

      {order.customer_note && (
        <p className="border-t border-hairline pb-[18px] pt-3.5 text-sm text-danger">{order.customer_note}</p>
      )}

      <div className="border-t border-hairline pt-[18px]">{children}</div>
    </article>
  );
}

function Qty({ n }: { n: number }) {
  return (
    <strong className="tnum h-[29px] shrink-0 whitespace-nowrap rounded-[5px] bg-paper px-1.5 py-[3px] text-sm">
      {n}×
    </strong>
  );
}


type TicketLine = BoardOrder["items"][number];

type TicketEntry =
  | { kind: "item"; item: TicketLine }
  | { kind: "combo"; name: string; quantity: number; items: TicketLine[] };

/**
 * Fold a ticket's lines so a combo reads as one thing.
 *
 * A combo is stored as one line per slot, because the kitchen plates items
 * rather than abstractions and a receipt has to price them. On the board that
 * has to be put back together: lines sharing a combo group are one meal deal,
 * and the order of everything else is preserved exactly as it was sent.
 *
 * The quantity is the deal's, not the sum of its parts. Two burger meals is
 * two, whatever three items each contains.
 */
export function groupTicket(items: TicketLine[]): TicketEntry[] {
  const entries: TicketEntry[] = [];
  const combos = new Map<number, TicketEntry & { kind: "combo" }>();

  for (const item of items) {
    if (item.combo_group == null) {
      entries.push({ kind: "item", item });
      continue;
    }

    const existing = combos.get(item.combo_group);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    // The first line of a combo holds its place in the ticket, so a deal
    // ordered before a loose item still reads first.
    const entry: TicketEntry & { kind: "combo" } = {
      kind: "combo",
      name: item.combo_name ?? "Combo",
      quantity: item.quantity,
      items: [item],
    };
    combos.set(item.combo_group, entry);
    entries.push(entry);
  }

  return entries;
}


const FINISHED: Record<string, string> = {
  COMPLETED_WITH_PIN: "handed over",
  COMPLETED_BY_OVERRIDE: "handed over without PIN",
  CANCELLED: "cancelled",
};

/**
 * Today's orders that have left the board.
 *
 * Once handed over or cancelled, an order used to vanish from every screen the
 * counter has, so "I ordered twenty minutes ago -- where is it?" had no answer.
 * Searchable by order number, which is what a customer reads out. Collapsed
 * until someone asks.
 */
function TodayHistory() {
  const history = useOrderHistoryQuery(undefined, { pollingInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const orders = history.data?.orders ?? [];
  const needle = search.replace(/\D/g, "");
  const shown = needle ? orders.filter((o) => String(o.order_number).includes(needle)) : orders;

  return (
    <section className="mt-6 border-t border-hairline pt-[22px]">
      <button
        type="button"
        className="flex w-full items-center justify-between py-4 text-left font-display text-2xl"
        aria-expanded={open}
        aria-controls="done-today"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Done today ({orders.length})</span>
        <span className={`transition-transform duration-disclose ${open ? "rotate-90" : ""}`}>
          <Icon name="chevron" />
        </span>
      </button>

      {open && (
        <div id="done-today" className="card mt-3 animate-disclose">
          {orders.length > 0 && (
            <label className="mb-2 block max-w-xs">
              <span className="label">Find an order number</span>
              <input
                className="field mt-[7px]"
                type="search"
                inputMode="numeric"
                placeholder="e.g. 1039"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
          {history.error ? (
            <ErrorNote message={errorMessage(history.error)} className="" />
          ) : !orders.length ? (
            <Empty>Nothing handed over or cancelled yet today.</Empty>
          ) : !shown.length ? (
            <Empty>No order today matches #{needle}.</Empty>
          ) : (
            <ul>
              {shown.map((o) => (
                <HistoryRow key={o.order_id} order={o} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryRow({ order }: { order: HistoryOrder }) {
  const action = order.last_action;
  const what =
    (action && FINISHED[action.action]) ??
    (order.status === "CANCELLED" ? "cancelled" : "handed over");
  const time = new Date(order.finished_at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const summary = order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
  const cancelled = order.status === "CANCELLED";

  return (
    <li className="border-b border-hairline py-5 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className="font-display text-lg font-normal">#{order.order_number}</strong>
        <span className="flex flex-wrap gap-2">
          <span className={cancelled ? "pill-red" : "pill-green"}>{what}</span>
          {(order.payment_status === "REFUNDED" || order.payment_status === "PARTIALLY_REFUNDED") && (
            <span className="pill-red">
              {order.payment_status === "REFUNDED" ? "refunded" : "partly refunded"}
            </span>
          )}
        </span>
      </div>
      <p className="mt-1 text-caption text-muted">
        {time}
        {action?.by && ` · ${action.by}`}
      </p>
      <p className="mt-1 text-caption">{summary}</p>
      {action?.reason && <p className="mt-3 text-caption">Reason: {action.reason}</p>}
    </li>
  );
}
