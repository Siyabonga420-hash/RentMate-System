-- Run once in Neon SQL Editor after 001_schema.sql. Existing records are preserved.
ALTER TABLE households ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'student_commune';
ALTER TABLE households ADD COLUMN IF NOT EXISTS pinned_note text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS groceries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES households(id),created_by uuid NOT NULL REFERENCES users(id),title text NOT NULL,purchased boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS kitchen_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES households(id),created_by uuid NOT NULL REFERENCES users(id),title text NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT booking_time_valid CHECK (ends_at>starts_at));
CREATE INDEX IF NOT EXISTS groceries_household_idx ON groceries(household_id);
CREATE INDEX IF NOT EXISTS bookings_household_idx ON kitchen_bookings(household_id,starts_at);
