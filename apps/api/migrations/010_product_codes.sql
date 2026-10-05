CREATE SEQUENCE product_code_number;
CREATE TABLE product_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id),
  code text NOT NULL,
  normalized_code text NOT NULL UNIQUE,
  code_type text NOT NULL,
  format text NOT NULL DEFAULT 'UNKNOWN',
  source text NOT NULL DEFAULT 'ADMIN_MANUAL',
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(normalized_code) BETWEEN 1 AND 512),
  CHECK (NOT is_primary OR is_active)
);
CREATE INDEX product_codes_part_idx ON product_codes(part_id);
CREATE UNIQUE INDEX product_codes_primary_idx ON product_codes(part_id) WHERE is_primary AND is_active;

-- Preserve ambiguous or malformed legacy values for explicit administrator resolution.
-- The original parts.barcode column remains untouched by this migration.
CREATE TABLE product_code_migration_conflicts (
  id bigserial PRIMARY KEY,
  normalized_code text NOT NULL,
  part_ids uuid[] NOT NULL,
  legacy_values jsonb NOT NULL,
  reason text NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id)
);
WITH legacy AS (
  SELECT id,barcode,btrim(barcode,E' \t\n\r\f\v') normalized FROM parts WHERE barcode IS NOT NULL
) INSERT INTO product_code_migration_conflicts(normalized_code,part_ids,legacy_values,reason)
SELECT normalized,array_agg(id),jsonb_agg(jsonb_build_object('part_id',id,'code',barcode)),
  CASE WHEN count(*)>1 THEN 'Duplicate normalized legacy barcode' ELSE 'Invalid legacy barcode' END
FROM legacy GROUP BY normalized
HAVING count(*)>1 OR length(normalized) NOT BETWEEN 1 AND 512 OR normalized ~ '[[:cntrl:]]';

INSERT INTO product_codes(part_id,code,normalized_code,code_type,source,is_primary)
SELECT p.id,btrim(p.barcode,E' \t\n\r\f\v'),btrim(p.barcode,E' \t\n\r\f\v'),
  'MANUFACTURER_BARCODE','LEGACY',true
FROM parts p WHERE p.barcode IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM product_code_migration_conflicts c WHERE p.id=ANY(c.part_ids));

ALTER TABLE business_settings ADD COLUMN scanner_settings jsonb NOT NULL DEFAULT
  '{"enabled":true,"terminator":"AUTO","min_length":4,"max_gap_ms":35,"max_average_ms":25,"sound":false,"continuous_camera":false,"camera_facing":"environment","camera_cooldown_ms":1000}'::jsonb;

CREATE TABLE scan_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  code_id uuid REFERENCES product_codes(id),
  part_id uuid REFERENCES parts(id),
  scan_source text NOT NULL,
  context text NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_events_time_idx ON scan_events(created_at);
ALTER TABLE invoice_lines ADD COLUMN scanned_code_id uuid REFERENCES product_codes(id);
ALTER TABLE invoice_lines ADD COLUMN added_via text NOT NULL DEFAULT 'MANUAL_PRODUCT_SELECTION';
