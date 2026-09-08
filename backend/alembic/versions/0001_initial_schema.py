"""Initial schema, RLS policies and role grants.

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# Tenant-owned tables. Every one of these carries restaurant_id and gets
# ENABLE + FORCE ROW LEVEL SECURITY.
TENANT_TABLES = [
    "restaurant_users",
    "restaurant_payment_accounts",
    "meals",
    "menu_categories",
    "menu_items",
    "modifier_groups",
    "modifier_options",
    "item_modifier_groups",
    "restaurant_order_counters",
    "orders",
    "order_items",
    "order_item_modifiers",
    "payments",
]

# Platform-owned. No tenant policy. Access is by identity, ownership, or an
# explicit system grant.
PLATFORM_TABLES = [
    "users",
    "stripe_events",
    "clerk_events",
    "idempotency_keys",
    "platform_audit_logs",
]

# The declared narrow cross-tenant discovery surface for zenoeats_system.
# Everything not on this list is denied. The CI privilege gate asserts it.
SYSTEM_READ_TABLES = [
    "restaurants",
    "restaurant_payment_accounts",
    "orders",
    "payments",
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    ts = lambda: sa.DateTime(timezone=True)  # noqa: E731
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    # ---------------- tenant root & identity ----------------
    op.create_table(
        "restaurants",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("tax_rate_bps", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tagline", sa.String(200)),
        sa.Column("accepting_orders", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_restaurants_status", "restaurants", ["status"])
    op.create_index("ix_restaurants_slug", "restaurants", ["slug"])

    op.create_table(
        "users",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("clerk_user_id", sa.String(255), nullable=False, unique=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("full_name", sa.String(160)),
        sa.Column("is_platform_admin", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_clerk", "users", ["clerk_user_id"])

    op.create_table(
        "restaurant_users",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("user_id", uid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role_code", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("invited_by_user_id", uid(), sa.ForeignKey("users.id")),
        sa.Column("invited_at", ts()),
        sa.Column("accepted_at", ts()),
        sa.Column("revoked_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("restaurant_id", "user_id", name="uq_restaurant_user"),
    )
    op.create_index("ix_restaurant_users_rid", "restaurant_users", ["restaurant_id"])
    op.create_index("ix_restaurant_users_uid", "restaurant_users", ["user_id"])

    op.create_table(
        "restaurant_payment_accounts",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"),
                  nullable=False, unique=True),
        sa.Column("provider", sa.String(24), nullable=False),
        sa.Column("stripe_account_id", sa.String(255), nullable=False, unique=True),
        sa.Column("charges_enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("payouts_enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("details_submitted", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("onboarding_status", sa.String(32), nullable=False),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rpa_account", "restaurant_payment_accounts", ["stripe_account_id"])

    # ---------------- catalog ----------------
    op.create_table(
        "meals",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_meals_rid", "meals", ["restaurant_id"])

    op.create_table(
        "menu_categories",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("meal_id", uid(), sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('FOOD','BEVERAGE','SAUCE')", name="ck_category_kind"),
    )
    op.create_index("ix_categories_rid", "menu_categories", ["restaurant_id"])
    op.create_index("ix_categories_meal", "menu_categories", ["meal_id"])

    op.create_table(
        "menu_items",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("category_id", uid(), sa.ForeignKey("menu_categories.id"), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("base_price_minor", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("is_available", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("image_path", sa.Text),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("base_price_minor >= 0", name="ck_item_price_non_negative"),
    )
    op.create_index("ix_items_rid", "menu_items", ["restaurant_id"])
    op.create_index("ix_items_available", "menu_items", ["restaurant_id", "is_available"])

    op.create_table(
        "modifier_groups",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("selection_type", sa.String(16), nullable=False),
        sa.Column("is_required", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("min_select", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_select", sa.Integer, nullable=False, server_default="1"),
        sa.Column("applies_to_kind", sa.String(16)),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("min_select >= 0", name="ck_group_min_non_negative"),
        sa.CheckConstraint("max_select >= min_select", name="ck_group_max_gte_min"),
        sa.CheckConstraint("selection_type IN ('SINGLE','MULTI')", name="ck_group_selection"),
    )
    op.create_index("ix_groups_rid", "modifier_groups", ["restaurant_id"])

    op.create_table(
        "modifier_options",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("group_id", uid(), sa.ForeignKey("modifier_groups.id"), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        # Deliberately no non-negative CHECK. A decrement modifier is valid.
        sa.Column("price_delta_minor", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_available", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_options_rid", "modifier_options", ["restaurant_id"])
    op.create_index("ix_options_group", "modifier_options", ["group_id"])

    op.create_table(
        "item_modifier_groups",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("group_id", uid(), sa.ForeignKey("modifier_groups.id"), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("item_id", "group_id", name="uq_item_modifier_group"),
    )
    op.create_index("ix_img_rid", "item_modifier_groups", ["restaurant_id"])
    op.create_index("ix_img_item", "item_modifier_groups", ["item_id"])
    op.create_index("ix_img_group", "item_modifier_groups", ["group_id"])

    # ---------------- commerce ----------------
    op.create_table(
        "restaurant_order_counters",
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), primary_key=True),
        sa.Column("next_order_number", sa.BigInteger, nullable=False, server_default="1001"),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("next_order_number >= 1", name="ck_counter_min"),
    )

    op.create_table(
        "orders",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("order_number", sa.BigInteger, nullable=False),
        sa.Column("customer_user_id", uid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("fulfillment_type", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("payment_method", sa.String(24), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("subtotal_minor", sa.BigInteger, nullable=False),
        sa.Column("discount_minor", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("tax_minor", sa.BigInteger, nullable=False),
        sa.Column("total_minor", sa.BigInteger, nullable=False),
        sa.Column("customer_note", sa.Text),
        sa.Column("pickup_pin_encrypted", sa.Text),
        sa.Column("pickup_pin_failed_attempts", sa.SmallInteger, nullable=False,
                  server_default="0"),
        sa.Column("expires_at", ts()),
        sa.Column("paid_at", ts()),
        sa.Column("completed_at", ts()),
        sa.Column("cancelled_reason", sa.String(120)),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("restaurant_id", "order_number",
                            name="uq_order_number_per_restaurant"),
        sa.CheckConstraint("subtotal_minor >= 0", name="ck_order_subtotal"),
        sa.CheckConstraint("discount_minor >= 0", name="ck_order_discount"),
        sa.CheckConstraint("tax_minor >= 0", name="ck_order_tax"),
        sa.CheckConstraint("total_minor >= 0", name="ck_order_total"),
        sa.CheckConstraint(
            "pickup_pin_failed_attempts >= 0 AND pickup_pin_failed_attempts <= 5",
            name="ck_order_pin_attempts",
        ),
    )
    op.create_index("ix_orders_rid", "orders", ["restaurant_id"])
    op.create_index("ix_orders_customer", "orders", ["customer_user_id"])
    op.create_index("ix_orders_board", "orders", ["restaurant_id", "status", "created_at"])
    op.create_index("ix_orders_expiry", "orders", ["status", "expires_at"])

    op.create_table(
        "order_items",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("order_id", uid(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("menu_item_id", uid(), sa.ForeignKey("menu_items.id")),
        sa.Column("name_snapshot", sa.String(180), nullable=False),
        sa.Column("unit_price_minor", sa.BigInteger, nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("line_total_minor", sa.BigInteger, nullable=False),
        sa.Column("item_note", sa.String(280)),
        sa.CheckConstraint("unit_price_minor >= 0", name="ck_order_item_price"),
        sa.CheckConstraint("quantity > 0", name="ck_order_item_qty"),
    )
    op.create_index("ix_order_items_rid", "order_items", ["restaurant_id"])
    op.create_index("ix_order_items_order", "order_items", ["order_id"])

    op.create_table(
        "order_item_modifiers",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("order_item_id", uid(), sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("modifier_option_id", uid()),
        sa.Column("group_name_snapshot", sa.String(180), nullable=False),
        sa.Column("option_name_snapshot", sa.String(180), nullable=False),
        sa.Column("unit_price_delta_minor", sa.BigInteger, nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.CheckConstraint("quantity > 0", name="ck_order_modifier_qty"),
    )
    op.create_index("ix_oim_rid", "order_item_modifiers", ["restaurant_id"])
    op.create_index("ix_oim_item", "order_item_modifiers", ["order_item_id"])

    op.create_table(
        "idempotency_keys",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("actor_id", uid(), nullable=False),
        sa.Column("endpoint", sa.String(255), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_status", sa.Integer),
        sa.Column("response_body", postgresql.JSONB),
        sa.Column("created_at", ts(), nullable=False),
        sa.Column("expires_at", ts(), nullable=False),
        sa.UniqueConstraint("key", "actor_id", "endpoint", name="uq_idempotency"),
    )
    op.create_index("ix_idempotency_expiry", "idempotency_keys", ["expires_at"])

    # ---------------- payments ----------------
    op.create_table(
        "payments",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("order_id", uid(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("method", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("amount_minor", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("stripe_account_id", sa.String(255)),
        sa.Column("stripe_payment_intent_id", sa.String(255)),
        sa.Column("stripe_client_secret", sa.Text),
        sa.Column("failure_message", sa.Text),
        sa.Column("succeeded_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount_minor >= 0", name="ck_payment_amount"),
    )
    op.create_index("ix_payments_rid", "payments", ["restaurant_id"])
    op.create_index("ix_payments_order", "payments", ["order_id"])
    op.create_index("ix_payments_status", "payments", ["status"])
    op.create_index("ix_payments_intent", "payments", ["stripe_payment_intent_id"])

    # Rule 29: at most one payment attempt per order may ever reach success.
    # succeeded_at is never cleared by a refund, so this holds permanently.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_one_successful_payment_per_order
        ON payments (order_id)
        WHERE succeeded_at IS NOT NULL
        """
    )

    op.create_table(
        "stripe_events",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("stripe_event_id", sa.String(255), nullable=False, unique=True),
        sa.Column("type", sa.String(128), nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("received_at", ts(), nullable=False),
        sa.Column("processed_at", ts()),
        sa.Column("error", sa.Text),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("stripe_account_id", sa.String(255)),
    )
    op.create_index("ix_stripe_events_type", "stripe_events", ["type"])
    op.create_index("ix_stripe_events_status", "stripe_events", ["status", "received_at"])
    op.create_index("ix_stripe_events_account", "stripe_events", ["stripe_account_id"])

    op.create_table(
        "clerk_events",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("clerk_event_id", sa.String(255), nullable=False, unique=True),
        sa.Column("type", sa.String(128), nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="RECEIVED"),
        sa.Column("received_at", ts(), nullable=False),
        sa.Column("processed_at", ts()),
        sa.Column("error", sa.Text),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_clerk_events_type", "clerk_events", ["type"])

    op.create_table(
        "platform_audit_logs",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("actor_user_id", uid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("scope", postgresql.JSONB, nullable=False),
        sa.Column("correlation_id", sa.String(128), nullable=False),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_action", "platform_audit_logs", ["action"])
    op.create_index("ix_audit_created", "platform_audit_logs", ["created_at"])

    _apply_security()


def _apply_security() -> None:
    """Row Level Security and role grants.

    This is the part that makes tenant isolation a database guarantee rather
    than an application convention.
    """
    # Tenant-owned tables: FORCE RLS so it applies to the table owner too if
    # the owner is ever used at runtime by mistake.
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY p_{table}_tenant ON {table}
            FOR ALL TO zenoeats_app
            USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
            """
        )

    # Tenant root: the key is the row id, not a restaurant_id column.
    op.execute("ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE restaurants FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_restaurants_tenant ON restaurants
        FOR ALL TO zenoeats_app
        USING (id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (id = current_setting('app.current_tenant', true)::uuid)
        """
    )

    # ---- zenoeats_app grants -------------------------------------------
    op.execute("GRANT USAGE ON SCHEMA public TO zenoeats_app")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zenoeats_app"
    )
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zenoeats_app")

    # The app role reads users to resolve the actor, and writes the
    # idempotency inbox inside the business transaction. Neither carries a
    # restaurant_id, so neither has a tenant policy; ownership checks in the
    # application govern them.

    # ---- zenoeats_system grants ----------------------------------------
    # Narrow and explicit. This is the surface the CI privilege gate asserts.
    op.execute("GRANT USAGE ON SCHEMA public TO zenoeats_system")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE ON stripe_events, clerk_events, "
        "platform_audit_logs, users TO zenoeats_system"
    )
    op.execute("GRANT SELECT ON idempotency_keys TO zenoeats_system")

    # Super Admin tenant administration runs here, so restaurants and the
    # counter are writable. Business mutation on orders and payments is NOT
    # granted: the worker discovers ids here and then switches to
    # zenoeats_app with a tenant context to do the actual work.
    op.execute(
        "GRANT SELECT, INSERT, UPDATE ON restaurants, restaurant_order_counters "
        "TO zenoeats_system"
    )
    op.execute("GRANT SELECT ON restaurant_payment_accounts TO zenoeats_system")
    op.execute(
        "GRANT SELECT (id, restaurant_id, status, expires_at, order_number, paid_at, "
        "total_minor, tax_minor, created_at) ON orders TO zenoeats_system"
    )
    op.execute(
        "GRANT SELECT (id, restaurant_id, order_id, status, stripe_payment_intent_id, "
        "stripe_account_id, succeeded_at) ON payments TO zenoeats_system"
    )

    # RLS still applies to the system role on tenant tables, so it needs an
    # explicit read policy on exactly the tables above. Column grants are what
    # keep the surface narrow; the policy only opens the rows.
    for table in SYSTEM_READ_TABLES:
        op.execute(
            f"""
            CREATE POLICY p_{table}_system_read ON {table}
            FOR SELECT TO zenoeats_system
            USING (true)
            """
        )
    op.execute(
        """
        CREATE POLICY p_restaurants_system_write ON restaurants
        FOR ALL TO zenoeats_system
        USING (true) WITH CHECK (true)
        """
    )
    op.execute("ALTER TABLE restaurant_order_counters ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_counters_system ON restaurant_order_counters
        FOR ALL TO zenoeats_system
        USING (true) WITH CHECK (true)
        """
    )

    # Future tables inherit sane defaults rather than being silently
    # unreachable after the next migration.
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zenoeats_app"
    )


def downgrade() -> None:
    for table in [
        "platform_audit_logs", "clerk_events", "stripe_events", "payments",
        "idempotency_keys", "order_item_modifiers", "order_items", "orders",
        "restaurant_order_counters", "item_modifier_groups", "modifier_options",
        "modifier_groups", "menu_items", "menu_categories", "meals",
        "restaurant_payment_accounts", "restaurant_users", "users", "restaurants",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
