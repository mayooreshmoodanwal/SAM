import { Router } from 'express';
import { z } from 'zod';
import { pool, tx, one, audit, HttpError } from './db.js';
import { wrap, requireActor, requireAdmin } from './http.js';

export const peopleRouter = Router();
const customerInput = z.object({
  type: z.enum(['INDIVIDUAL', 'FLEET']).default('INDIVIDUAL'),
  name: z.string().min(2),
  company_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  alternate_phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  gstin: z.string().optional().nullable(),
  billing_address: z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  credit_limit_paise: z.number().int().safe().min(0).default(0),
  credit_period_days: z.number().int().safe().min(0).default(0),
  notes: z.string().optional().nullable(),
});
peopleRouter.get(
  '/customers',
  wrap(async (req, res) => {
    const q = String(req.query.q || '');
    const rows = await pool.query(
      `SELECT * FROM customers WHERE $1='' OR name ILIKE '%'||$1||'%' OR company_name ILIKE '%'||$1||'%'
    OR phone ILIKE '%'||$1||'%' ORDER BY name LIMIT 100`,
      [q],
    );
    res.json(rows.rows);
  }),
);
peopleRouter.post(
  '/customers',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = customerInput.parse(req.body),
      keys = Object.keys(input);
    const row = (
      await pool.query(
        `INSERT INTO customers(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        keys.map((k) => (input as any)[k]),
      )
    ).rows[0];
    await audit(pool, actor.id, 'CREATE', 'customer', row.id);
    res.status(201).json(row);
  }),
);
peopleRouter.get(
  '/customers/:id',
  wrap(async (req, res) => {
    const customer = await one(pool, 'SELECT * FROM customers WHERE id=$1', [req.params.id]);
    const [vehicles, invoices, warranties, payments, returns, frequentParts] = await Promise.all([
      pool.query(
        `SELECT v.*,vc.model,vc.variant FROM customer_vehicles v LEFT JOIN vehicle_configurations vc ON vc.id=v.configuration_id WHERE v.customer_id=$1 ORDER BY v.created_at DESC`,
        [customer.id],
      ),
      pool.query(
        'SELECT id,invoice_number,total_paise,pending_paise,status,created_at FROM invoices WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50',
        [customer.id],
      ),
      pool.query(
        'SELECT id,claim_number,status,complaint,created_at FROM warranty_claims WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 30',
        [customer.id],
      ),
      pool.query(
        `SELECT ip.mode,ip.amount_paise,ip.paid_at,i.invoice_number FROM invoice_payments ip
      JOIN invoices i ON i.id=ip.invoice_id WHERE i.customer_id=$1 ORDER BY ip.paid_at DESC LIMIT 50`,
        [customer.id],
      ),
      pool.query(
        `SELECT sr.id,sr.reason,sr.created_at,sr.refund_paise,i.invoice_number FROM sales_returns sr
      JOIN invoices i ON i.id=sr.invoice_id WHERE i.customer_id=$1 ORDER BY sr.created_at DESC LIMIT 30`,
        [customer.id],
      ),
      pool.query(
        `SELECT p.name,p.sku,sum(il.quantity-il.returned_quantity) quantity FROM invoice_lines il
      JOIN invoices i ON i.id=il.invoice_id JOIN parts p ON p.id=il.part_id
      WHERE i.customer_id=$1 AND i.status='COMPLETED' GROUP BY p.id ORDER BY quantity DESC LIMIT 10`,
        [customer.id],
      ),
    ]);
    res.json({
      ...customer,
      vehicles: vehicles.rows,
      invoices: invoices.rows,
      warranties: warranties.rows,
      payments: payments.rows,
      returns: returns.rows,
      frequentParts: frequentParts.rows,
    });
  }),
);
peopleRouter.get(
  '/vehicle-configurations',
  wrap(async (req, res) => {
    const q = String(req.query.q || '');
    res.json(
      (
        await pool.query(
          "SELECT * FROM vehicle_configurations WHERE $1='' OR model ILIKE '%'||$1||'%' OR variant ILIKE '%'||$1||'%' ORDER BY model,variant LIMIT 100",
          [q],
        )
      ).rows,
    );
  }),
);
peopleRouter.post(
  '/vehicle-configurations',
  wrap(async (req, res) => {
    const actor = requireAdmin(req);
    const input = z
      .object({
        make: z.string().default('Ashok Leyland'),
        model: z.string().min(2),
        model_series: z.string().optional(),
        vehicle_type: z.string().optional(),
        variant: z.string().optional(),
        engine_model: z.string().optional(),
        emission_standard: z.string().optional(),
        fuel_type: z.string().optional(),
        horsepower_min: z.number().int().safe().optional(),
        horsepower_max: z.number().int().safe().optional(),
        gvw_category: z.string().optional(),
        axle_configuration: z.string().optional(),
        gearbox_model: z.string().optional(),
        front_axle_type: z.string().optional(),
        rear_axle_type: z.string().optional(),
        cabin_type: z.string().optional(),
        year_from: z.number().int().safe().optional(),
        year_to: z.number().int().safe().optional(),
        chassis_applicability: z.string().optional(),
        vin_applicability: z.string().optional(),
        remarks: z.string().optional(),
      })
      .parse(req.body);
    const keys = Object.keys(input);
    const row = (
      await pool.query(
        `INSERT INTO vehicle_configurations(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        keys.map((k) => (input as any)[k]),
      )
    ).rows[0];
    await audit(pool, actor.id, 'CREATE', 'vehicle_configuration', row.id);
    res.status(201).json(row);
  }),
);
const vehicleInput = z
  .object({
    customer_id: z.string().uuid(),
    configuration_id: z.string().uuid().optional().nullable(),
    registration_number: z.string().optional().nullable(),
    chassis_number: z.string().optional().nullable(),
    vin: z.string().optional().nullable(),
    engine_number: z.string().optional().nullable(),
    manufacturing_year: z.number().int().safe().optional().nullable(),
    purchase_date: z.string().optional().nullable(),
    current_odometer: z.number().int().safe().min(0).optional().nullable(),
    warranty_status: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .refine(
    (v) => !!(v.registration_number || v.chassis_number || v.vin),
    'Provide registration, chassis or VIN.',
  );
peopleRouter.get(
  '/vehicles',
  wrap(async (req, res) => {
    const q = String(req.query.q || '');
    res.json(
      (
        await pool.query(
          `SELECT v.*,c.name customer_name,vc.model,vc.variant,vc.engine_model,vc.emission_standard,vc.gearbox_model,vc.axle_configuration
    FROM customer_vehicles v JOIN customers c ON c.id=v.customer_id LEFT JOIN vehicle_configurations vc ON vc.id=v.configuration_id
    WHERE $1='' OR v.registration_number ILIKE '%'||$1||'%' OR v.chassis_number ILIKE '%'||$1||'%'
    OR v.vin ILIKE '%'||$1||'%' ORDER BY v.created_at DESC LIMIT 100`,
          [q],
        )
      ).rows,
    );
  }),
);
peopleRouter.post(
  '/vehicles',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = vehicleInput.parse(req.body),
      keys = Object.keys(input);
    const row = (
      await pool.query(
        `INSERT INTO customer_vehicles(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        keys.map((k) => (input as any)[k]),
      )
    ).rows[0];
    await audit(pool, actor.id, 'CREATE', 'vehicle', row.id);
    res.status(201).json(row);
  }),
);
peopleRouter.get(
  '/vehicles/lookup/:query',
  wrap(async (req, res) => {
    const q = req.params.query.trim();
    const vehicle = (
      await pool.query(
        `SELECT v.*,c.name customer_name,c.phone customer_phone,vc.*,
    v.id id,v.customer_id customer_id,v.configuration_id configuration_id
    FROM customer_vehicles v JOIN customers c ON c.id=v.customer_id
    LEFT JOIN vehicle_configurations vc ON vc.id=v.configuration_id
    WHERE upper(v.registration_number)=upper($1) OR upper(v.chassis_number)=upper($1) OR upper(v.vin)=upper($1)
    LIMIT 1`,
        [q],
      )
    ).rows[0];
    if (!vehicle)
      throw new HttpError(404, 'No registered vehicle matched that registration, chassis or VIN.');
    const parts = vehicle.configuration_id
      ? (
          await pool.query(
            `SELECT p.id,p.name,p.sku,p.oem_number,p.brand,p.part_type,p.selling_price_paise,
    p.current_stock-p.reserved_stock available_stock,p.rack,c.name category
    FROM part_compatibility pc JOIN parts p ON p.id=pc.part_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE pc.configuration_id=$1 AND p.active=true ORDER BY c.name,p.name`,
            [vehicle.configuration_id],
          )
        ).rows
      : [];
    res.json({ vehicle, parts });
  }),
);
peopleRouter.get(
  '/vehicles/:id',
  wrap(async (req, res) => {
    const vehicle = await one(
      pool,
      `SELECT v.*,c.name customer_name,vc.model,vc.variant,vc.engine_model,vc.emission_standard,
    vc.axle_configuration,vc.gearbox_model FROM customer_vehicles v JOIN customers c ON c.id=v.customer_id
    LEFT JOIN vehicle_configurations vc ON vc.id=v.configuration_id WHERE v.id=$1`,
      [req.params.id],
    );
    const [invoices, warranties, events] = await Promise.all([
      pool.query(
        'SELECT id,invoice_number,total_paise,created_at FROM invoices WHERE vehicle_id=$1 ORDER BY created_at DESC',
        [vehicle.id],
      ),
      pool.query(
        'SELECT id,claim_number,status,created_at FROM warranty_claims WHERE vehicle_id=$1 ORDER BY created_at DESC',
        [vehicle.id],
      ),
      pool.query(
        `SELECT ve.*,u.name created_by_name FROM vehicle_events ve JOIN users u ON u.id=ve.created_by
      WHERE ve.vehicle_id=$1 ORDER BY ve.created_at DESC LIMIT 100`,
        [vehicle.id],
      ),
    ]);
    res.json({
      ...vehicle,
      invoices: invoices.rows,
      warranties: warranties.rows,
      events: events.rows,
    });
  }),
);
peopleRouter.post(
  '/vehicles/:id/events',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = z
        .object({
          type: z.enum(['SERVICE_VISIT', 'NOTE', 'REPLACEMENT']),
          description: z.string().min(3),
          odometer: z.number().int().safe().min(0).optional(),
        })
        .parse(req.body);
    const event = await tx(async (db) => {
      const vehicle = await one(db, 'SELECT id FROM customer_vehicles WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      const row = (
        await db.query(
          `INSERT INTO vehicle_events(vehicle_id,type,description,odometer,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [vehicle.id, input.type, input.description, input.odometer ?? null, actor.id],
        )
      ).rows[0];
      if (input.odometer !== undefined)
        await db.query('UPDATE customer_vehicles SET current_odometer=$2 WHERE id=$1', [
          vehicle.id,
          input.odometer,
        ]);
      if (input.type === 'SERVICE_VISIT')
        await db.query('UPDATE customer_vehicles SET last_visit_at=now() WHERE id=$1', [
          vehicle.id,
        ]);
      await audit(db, actor.id, 'CREATE', 'vehicle_event', row.id, {
        vehicleId: vehicle.id,
        type: input.type,
      });
      return row;
    });
    res.status(201).json(event);
  }),
);
peopleRouter.get(
  '/suppliers',
  wrap(async (req, res) => {
    requireAdmin(req);
    const q = String(req.query.q || '');
    res.json(
      (
        await pool.query(
          "SELECT * FROM suppliers WHERE $1='' OR name ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%' ORDER BY name LIMIT 100",
          [q],
        )
      ).rows,
    );
  }),
);
peopleRouter.post(
  '/suppliers',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          name: z.string().min(2),
          vendor_code: z.string().optional(),
          contact_person: z.string().optional(),
          phone: z.string().optional(),
          alternate_phone: z.string().optional(),
          email: z.string().email().optional(),
          gstin: z.string().optional(),
          billing_address: z.string().optional(),
          shipping_address: z.string().optional(),
          credit_period_days: z.number().int().safe().min(0).default(0),
          credit_limit_paise: z.number().int().safe().min(0).default(0),
          preferred: z.boolean().default(false),
          average_lead_days: z.number().int().safe().optional(),
          status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).default('ACTIVE'),
          notes: z.string().optional(),
        })
        .parse(req.body);
    const keys = Object.keys(input),
      row = (
        await pool.query(
          `INSERT INTO suppliers(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
          keys.map((k) => (input as any)[k]),
        )
      ).rows[0];
    await audit(pool, actor.id, 'CREATE', 'supplier', row.id);
    res.status(201).json(row);
  }),
);
peopleRouter.get(
  '/suppliers/:id',
  wrap(async (req, res) => {
    requireAdmin(req);
    const supplier = await one(pool, 'SELECT * FROM suppliers WHERE id=$1', [req.params.id]);
    const [purchases, parts, payments, returns] = await Promise.all([
      pool.query(
        'SELECT id,purchase_number,status,total_paise,created_at FROM purchases WHERE supplier_id=$1 ORDER BY created_at DESC LIMIT 50',
        [supplier.id],
      ),
      pool.query(
        `SELECT pt.id,pt.name,pt.sku,sum(pl.quantity_received+pl.free_quantity) received,
      max(pl.rate_paise) last_rate_paise FROM purchase_lines pl JOIN purchases p ON p.id=pl.purchase_id
      JOIN parts pt ON pt.id=pl.part_id WHERE p.supplier_id=$1 GROUP BY pt.id ORDER BY received DESC LIMIT 50`,
        [supplier.id],
      ),
      pool.query(
        `SELECT pp.*,p.purchase_number FROM purchase_payments pp JOIN purchases p ON p.id=pp.purchase_id
      WHERE p.supplier_id=$1 ORDER BY pp.paid_at DESC LIMIT 50`,
        [supplier.id],
      ),
      pool.query(
        `SELECT pr.*,p.purchase_number,pt.name part_name FROM purchase_returns pr
      JOIN purchases p ON p.id=pr.purchase_id JOIN parts pt ON pt.id=pr.part_id
      WHERE p.supplier_id=$1 ORDER BY pr.created_at DESC LIMIT 50`,
        [supplier.id],
      ),
    ]);
    res.json({
      ...supplier,
      purchases: purchases.rows,
      parts: parts.rows,
      payments: payments.rows,
      returns: returns.rows,
    });
  }),
);
