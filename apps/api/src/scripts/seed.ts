import { pool, tx } from '../db.js';
import { hashPassword } from '../auth.js';
import { calculateLine, calculateInvoice, financialYear } from '../tax.js';
const password = process.env.SEED_ADMIN_PASSWORD;
if (process.env.NODE_ENV === 'production' || !password || password.length < 12) {
  throw new Error(
    'Development seed requires SEED_ADMIN_PASSWORD with at least 12 characters and NODE_ENV != production.',
  );
}
const categories = [
  'Engine',
  'Fuel System',
  'Cooling System',
  'Clutch',
  'Gearbox',
  'Propeller Shaft',
  'Differential',
  'Front Axle',
  'Rear Axle',
  'Brake System',
  'Suspension',
  'Steering',
  'Electrical',
  'Battery',
  'Lighting',
  'Cabin / Body',
  'Filters',
  'Belts',
  'Bearings',
  'Lubricants',
  'Tyres',
  'Fasteners',
  'Service Kits',
  'Consumables',
];
const parts = [
  [
    'Ashok Leyland Clutch Plate',
    'AL-CP-1616-BS6',
    'CL-1616-BS6',
    'Clutch',
    480000,
    565000,
    590000,
    8,
    'R3',
    'S2',
    'B4',
    12,
  ],
  [
    'Clutch Pressure Plate',
    'AL-PP-1616',
    'PP-1616-BS6',
    'Clutch',
    520000,
    610000,
    650000,
    6,
    'R3',
    'S2',
    'B5',
    12,
  ],
  [
    'H-Series Oil Filter',
    'AL-OF-H6',
    'OF-H6-001',
    'Filters',
    36000,
    48000,
    52000,
    32,
    'R1',
    'S1',
    'B2',
    6,
  ],
  [
    'H-Series Fuel Filter',
    'AL-FF-H6',
    'FF-H6-001',
    'Filters',
    52000,
    68000,
    72000,
    24,
    'R1',
    'S1',
    'B3',
    6,
  ],
  [
    'Heavy Duty Brake Lining Set',
    'AL-BL-2518',
    'BL-2518-04',
    'Brake System',
    195000,
    245000,
    260000,
    14,
    'R4',
    'S1',
    'B1',
    6,
  ],
  [
    'King Pin Repair Kit',
    'AL-KP-1616',
    'KP-1616-02',
    'Front Axle',
    275000,
    345000,
    360000,
    5,
    'R5',
    'S2',
    'B1',
    12,
  ],
  [
    'Front Wheel Bearing',
    'AL-WB-1616',
    'WB-1616-F',
    'Bearings',
    92000,
    118000,
    125000,
    18,
    'R5',
    'S1',
    'B6',
    12,
  ],
  [
    'Engine Air Filter',
    'AL-AF-H6',
    'AF-H6-001',
    'Filters',
    79000,
    98000,
    105000,
    20,
    'R1',
    'S2',
    'B2',
    6,
  ],
  [
    'Fan Belt H-Series',
    'AL-FB-H6',
    'FB-H6-001',
    'Belts',
    45000,
    58000,
    62000,
    12,
    'R2',
    'S1',
    'B4',
    6,
  ],
  [
    'Rear Hub Oil Seal',
    'AL-HOS-2518',
    'HOS-2518-R',
    'Rear Axle',
    31000,
    42000,
    45000,
    22,
    'R5',
    'S3',
    'B2',
    6,
  ],
] as const;
try {
  await tx(async (db) => {
    const existing = (await db.query("SELECT 1 FROM parts WHERE sku='CL-1616-BS6'")).rows;
    if (existing.length) {
      console.log('Development demo data already present; skipped.');
      return;
    }
    const admin = (
      await db.query(
        `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')
      ON CONFLICT(email) DO UPDATE SET name=excluded.name RETURNING id`,
        [
          'Demo Administrator',
          process.env.SEED_ADMIN_EMAIL || 'admin@shantiauto.local',
          hashPassword(password),
        ],
      )
    ).rows[0];
    const categoryIds = new Map<string, string>();
    for (const name of categories) {
      const row = (
        await db.query(
          'INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id',
          [name],
        )
      ).rows[0];
      categoryIds.set(name, row.id);
    }
    const supplier = (
      await db.query(`INSERT INTO suppliers(name,vendor_code,contact_person,phone,gstin,billing_address,credit_period_days,preferred)
      VALUES('Eastern Commercial Spares','ECS-001','Rakesh Mehta','9876543210','09ABCDE1234F1Z5',
      'Transport Nagar, Varanasi, Uttar Pradesh',30,true) RETURNING id`)
    ).rows[0];
    const fleet = (
      await db.query(`INSERT INTO customers(type,name,company_name,phone,gstin,credit_limit_paise,credit_period_days,billing_address)
      VALUES('FLEET','Kashi Roadways','Kashi Roadways Pvt Ltd','9812345678','09AAACK1234C1Z8',5000000,30,
      'Lahartara, Varanasi, Uttar Pradesh') RETURNING id`)
    ).rows[0];
    const individual = (
      await db.query(`INSERT INTO customers(name,phone,credit_limit_paise,credit_period_days)
      VALUES('Mahendra Yadav','9898123456',200000,15) RETURNING id`)
    ).rows[0];
    const config = (
      await db.query(`INSERT INTO vehicle_configurations(model,model_series,vehicle_type,variant,engine_model,
      emission_standard,fuel_type,axle_configuration,gearbox_model,year_from,year_to)
      VALUES('1616','Boss','Truck','1616 BS6','H-Series','BS6','Diesel','4x2','6-speed manual',2020,2030) RETURNING id`)
    ).rows[0];
    const config2 = (
      await db.query(`INSERT INTO vehicle_configurations(model,model_series,vehicle_type,variant,engine_model,
      emission_standard,fuel_type,axle_configuration,gearbox_model,year_from,year_to)
      VALUES('2518','U-Truck','Tipper','2518 BS6','H-Series','BS6','Diesel','6x4','9-speed manual',2020,2030) RETURNING id`)
    ).rows[0];
    const vehicle = (
      await db.query(
        `INSERT INTO customer_vehicles(customer_id,configuration_id,registration_number,chassis_number,vin,
      manufacturing_year,current_odometer) VALUES($1,$2,'UP65 BT 1234','MB1AA22BB33CC4455','MB1AA22BB33CC4455',2023,78450) RETURNING id`,
        [fleet.id, config.id],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO customer_vehicles(customer_id,configuration_id,registration_number,chassis_number,manufacturing_year)
      VALUES($1,$2,'UP65 CT 4567','MB1DD66EE77FF8899',2022)`,
      [individual.id, config2.id],
    );
    const partIds = new Map<string, string>();
    for (const [
      name,
      oem,
      sku,
      category,
      cost,
      price,
      mrp,
      stock,
      rack,
      shelf,
      bin,
      warranty,
    ] of parts) {
      const row = (
        await db.query(
          `INSERT INTO parts(name,short_name,oem_number,sku,barcode,category_id,brand,purchase_price_paise,
        selling_price_paise,mrp_paise,tax_mode,gst_bps,min_stock,reorder_level,reorder_quantity,rack,shelf,bin,warranty_months,
        preferred_supplier_id,opening_stock,hsn)
        VALUES($1,$2,$3,$4,$5,$6,'Ashok Leyland',$7,$8,$9,'INCLUSIVE',1800,3,4,8,$10,$11,$12,$13,$14,$15,'8708') RETURNING id`,
          [
            name,
            name
              .split(' ')
              .map((w) => w[0])
              .join(''),
            oem,
            sku,
            `890${String(partIds.size + 1).padStart(10, '0')}`,
            categoryIds.get(category),
            cost,
            price,
            mrp,
            rack,
            shelf,
            bin,
            warranty,
            supplier.id,
            stock,
          ],
        )
      ).rows[0];
      partIds.set(sku, row.id);
      await db.query(
        `SELECT move_stock($1,'OPENING_STOCK',$2,0,0,'DEMO_SEED',$3,$4,'Development seed opening stock')`,
        [row.id, stock, row.id, admin.id],
      );
      await db.query('INSERT INTO part_compatibility(part_id,configuration_id) VALUES($1,$2)', [
        row.id,
        config.id,
      ]);
      if (['BL-2518-04', 'HOS-2518-R', 'OF-H6-001', 'FF-H6-001'].includes(sku))
        await db.query('INSERT INTO part_compatibility(part_id,configuration_id) VALUES($1,$2)', [
          row.id,
          config2.id,
        ]);
    }
    const po = (
      await db.query(
        `INSERT INTO purchases(purchase_number,supplier_id,supplier_invoice_number,invoice_date,status,
      payment_status,total_paise,received_value_paise,created_by,received_by,received_at)
      VALUES('PO-DEMO-0001',$1,'ECS/2026/489',current_date,'RECEIVED','UNPAID',2832000,2832000,$2,$2,now()) RETURNING id`,
        [supplier.id, admin.id],
      )
    ).rows[0];
    const pl = (
      await db.query(
        `INSERT INTO purchase_lines(purchase_id,part_id,quantity_ordered,quantity_received,rate_paise,gst_bps,landed_unit_cost_paise)
      VALUES($1,$2,5,5,480000,1800,480000) RETURNING id`,
        [po.id, partIds.get('CL-1616-BS6')],
      )
    ).rows[0];
    await db.query(
      'INSERT INTO purchase_receipts(purchase_line_id,quantity,received_by,value_paise) VALUES($1,5,$2,2832000)',
      [pl.id, admin.id],
    );
    await db.query(
      `SELECT move_stock($1,'PURCHASE_RECEIVED',5,0,0,'PURCHASE',$2,$3,'Development seed purchase',NULL,$4)`,
      [partIds.get('CL-1616-BS6'), po.id, admin.id, supplier.id],
    );
    await db.query('UPDATE suppliers SET outstanding_paise=2832000 WHERE id=$1', [supplier.id]);
    const l = calculateLine({ quantity: 1, ratePaise: 565000, gstBps: 1800, taxMode: 'INCLUSIVE' }),
      t = calculateInvoice([l]);
    const fy = financialYear(),
      number = `SAM/${fy}/000001`;
    await db.query(
      'INSERT INTO invoice_counters(financial_year,next_number) VALUES($1,2) ON CONFLICT DO NOTHING',
      [fy],
    );
    const invoice = (
      await db.query(
        `INSERT INTO invoices(invoice_number,financial_year,customer_id,vehicle_id,created_by,
      subtotal_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,paid_paise,pending_paise)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0) RETURNING id`,
        [
          number,
          fy,
          fleet.id,
          vehicle.id,
          admin.id,
          t.subtotalPaise,
          t.taxablePaise,
          t.cgstPaise,
          t.sgstPaise,
          t.igstPaise,
          t.totalPaise,
        ],
      )
    ).rows[0];
    const il = (
      await db.query(
        `INSERT INTO invoice_lines(invoice_id,part_id,part_name,oem_number,sku,hsn,unit,quantity,mrp_paise,
      rate_paise,cost_paise,tax_mode,gst_bps,taxable_paise,gst_paise,total_paise,warranty_months)
      VALUES($1,$2,$3,$4,$5,'8708','Piece',1,590000,565000,480000,'INCLUSIVE',1800,$6,$7,$8,12) RETURNING id`,
        [
          invoice.id,
          partIds.get('CL-1616-BS6'),
          'Ashok Leyland Clutch Plate',
          'AL-CP-1616-BS6',
          'CL-1616-BS6',
          l.taxablePaise,
          l.gstPaise,
          l.totalPaise,
        ],
      )
    ).rows[0];
    await db.query(
      `SELECT move_stock($1,'SALE',-1,0,0,'INVOICE',$2,$3,'Development seed sale',$4,NULL,$5)`,
      [partIds.get('CL-1616-BS6'), invoice.id, admin.id, fleet.id, vehicle.id],
    );
    await db.query(
      "INSERT INTO invoice_payments(invoice_id,mode,amount_paise,recorded_by) VALUES($1,'UPI',$2,$3)",
      [invoice.id, t.totalPaise, admin.id],
    );
    await db.query(
      `INSERT INTO warranty_claims(claim_number,invoice_line_id,customer_id,vehicle_id,part_id,
      warranty_start,warranty_end,complaint,status,created_by)
      VALUES('WC-DEMO-0001',$1,$2,$3,$4,current_date,current_date+interval '12 months',
      'Intermittent clutch slip reported during loaded route','UNDER_REVIEW',$5)`,
      [il.id, fleet.id, vehicle.id, partIds.get('CL-1616-BS6'), admin.id],
    );
    console.log('Development demo seed created.');
  });
} finally {
  await pool.end();
}
