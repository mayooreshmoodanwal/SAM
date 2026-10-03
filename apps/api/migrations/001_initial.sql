CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
  password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('ADMIN','EMPLOYEE')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE business_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id=1), name text NOT NULL DEFAULT 'Shanti Auto Mobiles',
  address text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '', invoice_prefix text NOT NULL DEFAULT 'SAM',
  default_gst_bps integer NOT NULL DEFAULT 1800 CHECK (default_gst_bps BETWEEN 0 AND 10000),
  invoice_footer text NOT NULL DEFAULT '', terms text NOT NULL DEFAULT '',
  negative_stock_allowed boolean NOT NULL DEFAULT false, paper_format text NOT NULL DEFAULT 'A4',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO business_settings(id) VALUES (1);
CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, vendor_code text UNIQUE,
  contact_person text, phone text, alternate_phone text, email text, gstin text,
  billing_address text, shipping_address text, credit_period_days integer NOT NULL DEFAULT 0,
  credit_limit_paise bigint NOT NULL DEFAULT 0, outstanding_paise bigint NOT NULL DEFAULT 0,
  preferred boolean NOT NULL DEFAULT false, average_lead_days integer,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_name_idx ON suppliers USING gin(name gin_trgm_ops);
CREATE INDEX suppliers_gstin_idx ON suppliers(gstin);
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'INDIVIDUAL' CHECK (type IN ('INDIVIDUAL','FLEET')),
  name text NOT NULL, company_name text, phone text, alternate_phone text, email text, gstin text,
  billing_address text, shipping_address text, credit_limit_paise bigint NOT NULL DEFAULT 0,
  credit_period_days integer NOT NULL DEFAULT 0, outstanding_paise bigint NOT NULL DEFAULT 0,
  notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers USING gin(name gin_trgm_ops);
CREATE INDEX customers_phone_idx ON customers(phone);
CREATE INDEX customers_gstin_idx ON customers(gstin);
CREATE TABLE vehicle_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL DEFAULT 'Ashok Leyland',
  model text NOT NULL, model_series text, vehicle_type text, variant text, engine_model text,
  emission_standard text, fuel_type text, horsepower_min integer, horsepower_max integer,
  gvw_category text, axle_configuration text, gearbox_model text, front_axle_type text,
  rear_axle_type text, cabin_type text, year_from integer, year_to integer,
  chassis_applicability text, vin_applicability text, remarks text
);
CREATE TABLE customer_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  configuration_id uuid REFERENCES vehicle_configurations(id), registration_number text UNIQUE,
  chassis_number text UNIQUE, vin text UNIQUE, engine_number text, manufacturing_year integer,
  purchase_date date, current_odometer integer, warranty_status text, notes text,
  last_visit_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_number IS NOT NULL OR chassis_number IS NOT NULL OR vin IS NOT NULL)
);
CREATE INDEX customer_vehicles_registration_idx ON customer_vehicles(registration_number);
CREATE INDEX customer_vehicles_chassis_idx ON customer_vehicles(chassis_number);
CREATE INDEX customer_vehicles_vin_idx ON customer_vehicles(vin);
CREATE TABLE parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), internal_id text UNIQUE, name text NOT NULL,
  short_name text, oem_number text, sku text NOT NULL UNIQUE, barcode text UNIQUE,
  category_id uuid REFERENCES categories(id), subcategory text, brand text NOT NULL DEFAULT 'Ashok Leyland',
  part_type text NOT NULL DEFAULT 'GENUINE' CHECK (part_type IN ('GENUINE','AFTERMARKET')),
  unit text NOT NULL DEFAULT 'Piece', hsn text, description text,
  purchase_price_paise bigint NOT NULL DEFAULT 0 CHECK (purchase_price_paise>=0),
  selling_price_paise bigint NOT NULL CHECK (selling_price_paise>=0),
  mrp_paise bigint NOT NULL DEFAULT 0 CHECK (mrp_paise>=0),
  tax_mode text NOT NULL DEFAULT 'INCLUSIVE' CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE','EXEMPT')),
  gst_bps integer NOT NULL DEFAULT 1800 CHECK (gst_bps BETWEEN 0 AND 10000),
  opening_stock integer NOT NULL DEFAULT 0 CHECK (opening_stock>=0),
  current_stock integer NOT NULL DEFAULT 0 CHECK (current_stock>=0),
  reserved_stock integer NOT NULL DEFAULT 0 CHECK (reserved_stock>=0),
  damaged_stock integer NOT NULL DEFAULT 0 CHECK (damaged_stock>=0),
  returned_stock integer NOT NULL DEFAULT 0 CHECK (returned_stock>=0),
  min_stock integer NOT NULL DEFAULT 0, max_stock integer, reorder_level integer NOT NULL DEFAULT 0,
  reorder_quantity integer NOT NULL DEFAULT 0, safety_stock integer NOT NULL DEFAULT 0,
  rack text, shelf text, bin text, preferred_supplier_id uuid REFERENCES suppliers(id),
  warranty_months integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
  notes text, last_stock_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), CHECK (reserved_stock <= current_stock)
);
CREATE INDEX parts_name_idx ON parts USING gin(name gin_trgm_ops);
CREATE INDEX parts_short_name_idx ON parts USING gin(short_name gin_trgm_ops);
CREATE INDEX parts_oem_idx ON parts(oem_number);
CREATE INDEX parts_barcode_idx ON parts(barcode);
CREATE INDEX parts_category_idx ON parts(category_id);
CREATE TABLE part_compatibility (
  part_id uuid NOT NULL REFERENCES parts(id), configuration_id uuid NOT NULL REFERENCES vehicle_configurations(id),
  remarks text, PRIMARY KEY (part_id,configuration_id)
);
CREATE TABLE stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_id uuid NOT NULL REFERENCES parts(id),
  type text NOT NULL, quantity integer NOT NULL CHECK (quantity>0),
  delta_current integer NOT NULL, delta_reserved integer NOT NULL DEFAULT 0,
  delta_damaged integer NOT NULL DEFAULT 0, previous_stock integer NOT NULL,
  new_stock integer NOT NULL, reference_type text NOT NULL, reference_id text NOT NULL,
  customer_id uuid REFERENCES customers(id), supplier_id uuid REFERENCES suppliers(id),
  vehicle_id uuid REFERENCES customer_vehicles(id), user_id uuid REFERENCES users(id),
  reason text NOT NULL, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_transactions_part_time_idx ON stock_transactions(part_id,created_at DESC);
CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_number text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id), supplier_invoice_number text,
  invoice_date date, expected_date date, received_at timestamptz, payment_due_date date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED','RETURNED')),
  payment_status text NOT NULL DEFAULT 'UNPAID', total_paise bigint NOT NULL DEFAULT 0,
  paid_paise bigint NOT NULL DEFAULT 0, freight_paise bigint NOT NULL DEFAULT 0,
  other_charges_paise bigint NOT NULL DEFAULT 0, notes text,
  created_by uuid REFERENCES users(id), received_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES purchases(id),
  part_id uuid NOT NULL REFERENCES parts(id), quantity_ordered integer NOT NULL CHECK (quantity_ordered>0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received>=0),
  free_quantity integer NOT NULL DEFAULT 0 CHECK (free_quantity>=0),
  rate_paise bigint NOT NULL CHECK (rate_paise>=0), discount_paise bigint NOT NULL DEFAULT 0,
  gst_bps integer NOT NULL DEFAULT 1800, freight_paise bigint NOT NULL DEFAULT 0,
  other_charges_paise bigint NOT NULL DEFAULT 0, landed_unit_cost_paise bigint,
  batch_number text, lot_number text, warehouse text, rack text,
  CHECK (quantity_received<=quantity_ordered)
);
CREATE TABLE purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_line_id uuid NOT NULL REFERENCES purchase_lines(id),
  quantity integer NOT NULL CHECK (quantity>0), free_quantity integer NOT NULL DEFAULT 0,
  received_by uuid NOT NULL REFERENCES users(id), received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchase_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES purchases(id),
  amount_paise bigint NOT NULL CHECK (amount_paise>0), mode text NOT NULL, reference text,
  paid_at timestamptz NOT NULL DEFAULT now(), recorded_by uuid REFERENCES users(id)
);
CREATE TABLE invoice_counters (financial_year text PRIMARY KEY, next_number integer NOT NULL DEFAULT 1);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number text NOT NULL UNIQUE,
  financial_year text NOT NULL, customer_id uuid REFERENCES customers(id), vehicle_id uuid REFERENCES customer_vehicles(id),
  created_by uuid NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','CANCELLED')),
  place_of_supply text, interstate boolean NOT NULL DEFAULT false,
  subtotal_paise bigint NOT NULL, discount_paise bigint NOT NULL DEFAULT 0,
  taxable_paise bigint NOT NULL, cgst_paise bigint NOT NULL, sgst_paise bigint NOT NULL,
  igst_paise bigint NOT NULL, round_off_paise bigint NOT NULL DEFAULT 0,
  total_paise bigint NOT NULL, paid_paise bigint NOT NULL DEFAULT 0,
  pending_paise bigint NOT NULL DEFAULT 0, due_date date,
  remarks text, cancellation_reason text, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_time_idx ON invoices(created_at DESC);
CREATE INDEX invoices_customer_idx ON invoices(customer_id,created_at DESC);
CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id),
  part_id uuid NOT NULL REFERENCES parts(id), part_name text NOT NULL, oem_number text,
  sku text NOT NULL, hsn text, unit text NOT NULL, quantity integer NOT NULL CHECK (quantity>0),
  mrp_paise bigint NOT NULL, rate_paise bigint NOT NULL, cost_paise bigint NOT NULL,
  tax_mode text NOT NULL, gst_bps integer NOT NULL, discount_paise bigint NOT NULL DEFAULT 0,
  taxable_paise bigint NOT NULL, gst_paise bigint NOT NULL, total_paise bigint NOT NULL,
  warranty_months integer NOT NULL DEFAULT 0, returned_quantity integer NOT NULL DEFAULT 0
);
CREATE TABLE invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id),
  mode text NOT NULL CHECK (mode IN ('CASH','UPI','CARD','BANK_TRANSFER')),
  amount_paise bigint NOT NULL CHECK (amount_paise>0), reference text,
  recorded_by uuid REFERENCES users(id), paid_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id),
  reason text NOT NULL, refund_paise bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), return_id uuid NOT NULL REFERENCES sales_returns(id),
  invoice_line_id uuid NOT NULL REFERENCES invoice_lines(id), quantity integer NOT NULL CHECK (quantity>0),
  condition text NOT NULL CHECK (condition IN ('GOOD','DAMAGED','DEFECTIVE','WARRANTY')),
  amount_paise bigint NOT NULL
);
CREATE TABLE purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES purchases(id),
  part_id uuid NOT NULL REFERENCES parts(id), quantity integer NOT NULL CHECK (quantity>0),
  reason text NOT NULL, credit_note text, refund_paise bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'COMPLETED', created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_number text NOT NULL UNIQUE,
  invoice_line_id uuid NOT NULL REFERENCES invoice_lines(id), customer_id uuid REFERENCES customers(id),
  vehicle_id uuid REFERENCES customer_vehicles(id), part_id uuid NOT NULL REFERENCES parts(id),
  serial_number text, warranty_start date NOT NULL, warranty_end date NOT NULL,
  complaint text NOT NULL, submitted_at timestamptz, status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','REPLACEMENT_ORDERED','REPLACEMENT_RECEIVED','COMPLETED')),
  replacement_part_id uuid REFERENCES parts(id), remarks text,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_date date NOT NULL, category text NOT NULL,
  description text NOT NULL, amount_paise bigint NOT NULL CHECK (amount_paise>0),
  payment_mode text NOT NULL, vendor text, reference text, notes text,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History records are append only'; END $$;
CREATE TRIGGER stock_history_immutable BEFORE UPDATE OR DELETE ON stock_transactions FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER audit_history_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_history_change();

CREATE OR REPLACE FUNCTION move_stock(
  p_part_id uuid, p_type text, p_delta_current integer, p_delta_reserved integer,
  p_delta_damaged integer, p_reference_type text, p_reference_id text,
  p_user_id uuid, p_reason text, p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL, p_vehicle_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_part parts%ROWTYPE; v_new integer; v_reserved integer; v_damaged integer;
BEGIN
  IF trim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION 'Stock movement requires a reason'; END IF;
  SELECT * INTO v_part FROM parts WHERE id=p_part_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part not found'; END IF;
  v_new := v_part.current_stock + p_delta_current;
  v_reserved := v_part.reserved_stock + p_delta_reserved;
  v_damaged := v_part.damaged_stock + p_delta_damaged;
  IF v_new < 0 OR v_reserved < 0 OR v_damaged < 0 OR v_reserved > v_new THEN
    RAISE EXCEPTION 'Insufficient available stock';
  END IF;
  UPDATE parts SET current_stock=v_new,reserved_stock=v_reserved,damaged_stock=v_damaged,
    returned_stock=returned_stock + CASE WHEN p_type='SALES_RETURN' THEN greatest(p_delta_current,p_delta_damaged) ELSE 0 END,
    last_stock_at=now(),updated_at=now() WHERE id=p_part_id;
  INSERT INTO stock_transactions(part_id,type,quantity,delta_current,delta_reserved,delta_damaged,
    previous_stock,new_stock,reference_type,reference_id,user_id,reason,customer_id,supplier_id,vehicle_id,notes)
  VALUES(p_part_id,p_type,greatest(abs(p_delta_current),abs(p_delta_reserved),abs(p_delta_damaged)),
    p_delta_current,p_delta_reserved,p_delta_damaged,v_part.current_stock,v_new,p_reference_type,
    p_reference_id,p_user_id,p_reason,p_customer_id,p_supplier_id,p_vehicle_id,p_notes);
END $$;
