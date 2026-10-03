ALTER TABLE sales_returns ADD COLUMN refunded_paise bigint NOT NULL DEFAULT 0 CHECK (refunded_paise>=0);
CREATE TABLE sales_return_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), return_id uuid NOT NULL REFERENCES sales_returns(id),
  amount_paise bigint NOT NULL CHECK (amount_paise>0),
  mode text NOT NULL CHECK (mode IN ('CASH','UPI','CARD','BANK_TRANSFER')),
  reference text, recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
