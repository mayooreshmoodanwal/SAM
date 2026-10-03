CREATE TABLE part_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_id uuid NOT NULL REFERENCES parts(id),
  old_purchase_paise bigint NOT NULL, new_purchase_paise bigint NOT NULL,
  old_selling_paise bigint NOT NULL, new_selling_paise bigint NOT NULL,
  old_mrp_paise bigint NOT NULL, new_mrp_paise bigint NOT NULL,
  source text NOT NULL, changed_by uuid REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX part_price_history_part_time_idx ON part_price_history(part_id,changed_at DESC);
CREATE TRIGGER part_price_history_immutable BEFORE UPDATE OR DELETE ON part_price_history FOR EACH ROW EXECUTE FUNCTION reject_history_change();
