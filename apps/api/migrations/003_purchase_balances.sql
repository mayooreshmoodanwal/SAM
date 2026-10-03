ALTER TABLE purchases ADD COLUMN received_value_paise bigint NOT NULL DEFAULT 0 CHECK (received_value_paise>=0);
UPDATE purchases SET received_value_paise=total_paise WHERE status='RECEIVED';
ALTER TABLE purchase_returns ADD COLUMN credit_paise bigint NOT NULL DEFAULT 0 CHECK (credit_paise>=0);
ALTER TABLE suppliers ADD COLUMN credit_balance_paise bigint NOT NULL DEFAULT 0 CHECK (credit_balance_paise>=0);
