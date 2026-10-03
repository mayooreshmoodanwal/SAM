ALTER TABLE purchase_receipts ADD COLUMN value_paise bigint NOT NULL DEFAULT 0 CHECK (value_paise>=0);
WITH totals AS (
  SELECT pr.id,round(p.received_value_paise::numeric * pr.quantity /
    nullif(sum(pr.quantity) OVER (PARTITION BY p.id),0))::bigint value
  FROM purchase_receipts pr JOIN purchase_lines pl ON pl.id=pr.purchase_line_id
  JOIN purchases p ON p.id=pl.purchase_id
)
UPDATE purchase_receipts pr SET value_paise=totals.value FROM totals WHERE totals.id=pr.id;
