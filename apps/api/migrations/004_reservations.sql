CREATE TABLE stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_id uuid NOT NULL REFERENCES parts(id),
  quantity integer NOT NULL CHECK (quantity>0), released_quantity integer NOT NULL DEFAULT 0 CHECK (released_quantity>=0),
  reference text NOT NULL, reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (released_quantity<=quantity)
);
CREATE INDEX stock_reservations_part_idx ON stock_reservations(part_id,created_at DESC);
