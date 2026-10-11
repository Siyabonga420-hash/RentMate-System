-- RENTMATE RECURRING MONTHLY RENT
-- Apply once after reviewing the migration.
-- This file does not execute automatically.

BEGIN;

CREATE TABLE IF NOT EXISTS recurring_rent_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    manager_id uuid NOT NULL
        REFERENCES managers(id)
        ON DELETE CASCADE,

    amount_due numeric(12,2) NOT NULL
        CHECK (amount_due > 0),

    billing_frequency text NOT NULL DEFAULT 'monthly'
        CHECK (billing_frequency = 'monthly'),

    due_day integer NOT NULL DEFAULT 31
        CHECK (due_day BETWEEN 1 AND 31),

    use_month_end boolean NOT NULL DEFAULT true,

    enabled boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),

    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recurring_rent_manager_unique
        UNIQUE (manager_id)
);

CREATE TABLE IF NOT EXISTS recurring_rent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    manager_id uuid NOT NULL
        REFERENCES managers(id)
        ON DELETE CASCADE,

    billing_month date NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recurring_rent_runs_unique
        UNIQUE (manager_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_recurring_rent_enabled
    ON recurring_rent_settings(enabled)
    WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_recurring_rent_runs_manager
    ON recurring_rent_runs(manager_id);

CREATE TABLE IF NOT EXISTS recurring_rent_charges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    manager_id uuid NOT NULL
        REFERENCES managers(id)
        ON DELETE CASCADE,

    tenant_id uuid NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    rent_id uuid NOT NULL
        REFERENCES rent(id)
        ON DELETE CASCADE,

    billing_month date NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recurring_rent_charges_tenant_month_unique
        UNIQUE (tenant_id, billing_month),

    CONSTRAINT recurring_rent_charges_rent_unique
        UNIQUE (rent_id)
);

CREATE INDEX IF NOT EXISTS idx_recurring_rent_charges_manager
    ON recurring_rent_charges(manager_id, billing_month);

COMMIT;