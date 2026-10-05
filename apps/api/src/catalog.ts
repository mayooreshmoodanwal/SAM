import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, tx, one, audit, HttpError } from './db.js';
import { wrap, requireAdmin, requireActor } from './http.js';
import { parseCsv, importHeaders, csvTemplate } from './csv.js';
import { stringify } from 'csv-stringify/sync';
import { CsvError } from 'csv-parse';
import { codeInput, normalizeCode } from './product-code-domain.js';
import { assignCode, changeLegacyBarcode, conflictMessage } from './product-code-service.js';

export const catalogRouter = Router();
const parsedImportRow = (values: string[], headers: string[]) => {
  const record = Object.fromEntries(headers.map((h, i) => [h, values[i] || '']));
  const money = (key: string) => Math.round(Number(record[key] || 0) * 100);
  const number = (key: string) => Number(record[key] || 0);
  const taxMode = (record['Tax Mode'] || 'INCLUSIVE').toUpperCase().replaceAll(' ', '_');
  return {
    name: record['Part Name'],
    short_name: record['Short Name'] || null,
    oem_number: record['OEM Number'] || null,
    sku: record.SKU,
    category: record.Category,
    brand: record.Brand || 'Ashok Leyland',
    purchase_price_paise: money('Purchase Price'),
    selling_price_paise: money('Selling Price'),
    mrp_paise: money('MRP'),
    gst_bps: Math.round(number('GST') * 100),
    tax_mode: taxMode,
    hsn: record.HSN || null,
    opening_stock: number('Opening Stock'),
    min_stock: number('Minimum Stock'),
    rack: record.Rack || null,
    barcode: record.Barcode?.trim() || null,
    codes: [
      record.Barcode && {
        code: record.Barcode,
        code_type: 'MANUFACTURER_BARCODE',
        is_primary: true,
      },
      record['Alternate Barcode'] && {
        code: record['Alternate Barcode'],
        code_type: 'ALTERNATE_BARCODE',
      },
      record['QR Identifier'] && {
        code: record['QR Identifier'],
        code_type: 'QR_CODE',
        format: 'QR_CODE',
      },
    ]
      .filter(Boolean)
      .map((c: any) => ({ ...c, code: normalizeCode(c.code), source: 'IMPORT' })),
  };
};
async function validateImport(csv: string) {
  let parsed: string[][];
  try {
    parsed = parseCsv(csv);
  } catch (error) {
    if (error instanceof CsvError) throw new HttpError(400, 'CSV formatting is invalid.');
    throw error;
  }
  if (parsed.length < 2) throw new HttpError(400, 'CSV has no part rows.');
  const headers = parsed[0].map((h) => h.replace(/^\uFEFF/, ''));
  for (const required of ['Part Name', 'SKU', 'Category', 'Selling Price'])
    if (!headers.includes(required)) throw new HttpError(400, `Missing column: ${required}`);
  if (parsed.length > 1001) throw new HttpError(400, 'Import at most 1,000 parts at a time.');
  const categories = (await pool.query('SELECT id,name FROM categories WHERE active=true')).rows;
  const settings = await one(pool, 'SELECT default_gst_bps FROM business_settings WHERE id=1');
  const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const incoming = parsed.slice(1).map((r) => parsedImportRow(r, headers));
  const skus = incoming.map((r) => r.sku).filter(Boolean);
  const barcodes = incoming.flatMap((r) => r.codes.map((c) => c.code));
  const existing = (await pool.query('SELECT sku FROM parts WHERE sku=ANY($1)', [skus])).rows.map(
    (r) => r.sku,
  );
  const existingBarcodes = (
    await pool.query(
      'SELECT pc.normalized_code barcode,p.name part_name,p.oem_number,p.sku,pc.is_active FROM product_codes pc JOIN parts p ON p.id=pc.part_id WHERE pc.normalized_code=ANY($1)',
      [barcodes],
    )
  ).rows;
  const existingSet = new Set(existing),
    existingBarcodeSet = new Map(existingBarcodes.map((r) => [r.barcode, r])),
    seen = new Set<string>(),
    seenBarcodes = new Set<string>();
  const valid: any[] = [],
    invalid: any[] = [],
    duplicates: any[] = [];
  parsed.slice(1).forEach((values, index) => {
    const row = parsedImportRow(values, headers),
      errors: string[] = [];
    if (!values[headers.indexOf('GST')]) row.gst_bps = Number(settings.default_gst_bps);
    if (!row.name || row.name.length < 2) errors.push('Part Name is required.');
    if (!row.sku || row.sku.length < 2) errors.push('SKU is required.');
    if (!values[headers.indexOf('Selling Price')]) errors.push('Selling Price is required.');
    if (!categoryMap.has(row.category.toLowerCase())) errors.push('Unknown category.');
    for (const key of [
      'purchase_price_paise',
      'selling_price_paise',
      'mrp_paise',
      'opening_stock',
      'min_stock',
      'gst_bps',
    ])
      if (!Number.isInteger((row as any)[key]) || (row as any)[key] < 0)
        errors.push(`Invalid ${key}.`);
    if (row.gst_bps > 10000) errors.push('GST exceeds 100%.');
    if (!['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT'].includes(row.tax_mode))
      errors.push('Invalid Tax Mode.');
    if (existingSet.has(row.sku) || seen.has(row.sku)) {
      duplicates.push({ row: index + 2, sku: row.sku, reason: 'Duplicate SKU' });
      return;
    }
    seen.add(row.sku);
    for (const code of row.codes) {
      const parsedCode = codeInput.safeParse(code);
      if (!parsedCode.success)
        errors.push(
          'Invalid product code: ' + parsedCode.error.issues.map((i) => i.message).join(', '),
        );
      if (existingBarcodeSet.has(code.code) || seenBarcodes.has(code.code)) {
        const owner = existingBarcodeSet.get(code.code);
        duplicates.push({
          row: index + 2,
          sku: row.sku,
          reason: owner ? conflictMessage(owner) : `Duplicate code in this file: ${code.code}`,
        });
        return;
      }
      seenBarcodes.add(code.code);
    }
    if (errors.length) invalid.push({ row: index + 2, sku: row.sku, errors });
    else
      valid.push({
        ...row,
        category_id: categoryMap.get(row.category.toLowerCase()),
        row: index + 2,
      });
  });
  return { valid, invalid, duplicates };
}
catalogRouter.get(
  '/parts/import/template',
  wrap(async (req, res) => {
    requireAdmin(req);
    res
      .type('text/csv')
      .setHeader('Content-Disposition', 'attachment; filename="sam-parts-template.csv"');
    res.send(csvTemplate());
  }),
);
catalogRouter.post(
  '/parts/import/preview',
  wrap(async (req, res) => {
    requireAdmin(req);
    const { csv } = z.object({ csv: z.string().min(1) }).parse(req.body);
    res.json(await validateImport(csv));
  }),
);
catalogRouter.post(
  '/parts/import',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      { csv } = z.object({ csv: z.string().min(1) }).parse(req.body);
    const preview = await validateImport(csv);
    if (preview.invalid.length || preview.duplicates.length)
      throw new HttpError(400, 'Fix invalid and duplicate rows before import.');
    const count = await tx(async (db) => {
      for (const row of preview.valid) {
        const part = (
          await db.query(
            `INSERT INTO parts(name,short_name,oem_number,sku,category_id,brand,purchase_price_paise,
        selling_price_paise,mrp_paise,gst_bps,tax_mode,hsn,opening_stock,min_stock,rack,barcode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
            [
              row.name,
              row.short_name,
              row.oem_number,
              row.sku,
              row.category_id,
              row.brand,
              row.purchase_price_paise,
              row.selling_price_paise,
              row.mrp_paise,
              row.gst_bps,
              row.tax_mode,
              row.hsn,
              row.opening_stock,
              row.min_stock,
              row.rack,
              null,
            ],
          )
        ).rows[0];
        for (const code of [...row.codes].sort((a, b) => a.code.localeCompare(b.code)))
          await assignCode(db, part.id, code, actor.id);
        if (row.opening_stock)
          await db.query(
            `SELECT move_stock($1,'OPENING_STOCK',$2,0,0,'IMPORT',$3,$4,'CSV opening stock')`,
            [part.id, row.opening_stock, part.id, actor.id],
          );
      }
      await audit(db, actor.id, 'IMPORT', 'parts', 'batch', { count: preview.valid.length });
      return preview.valid.length;
    });
    res.status(201).json({ imported: count });
  }),
);
const money = z.number().int().safe().min(0);
const partInput = z.object({
  name: z.string().min(2),
  short_name: z.string().optional().nullable(),
  internal_id: z.string().optional().nullable(),
  oem_number: z.string().optional().nullable(),
  sku: z.string().min(2),
  barcode: z.string().optional().nullable(),
  codes: z.array(codeInput).max(30).default([]),
  category_id: z.string().uuid().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  brand: z.string().min(1).default('Ashok Leyland'),
  part_type: z.enum(['GENUINE', 'AFTERMARKET']).default('GENUINE'),
  unit: z.string().min(1).default('Piece'),
  hsn: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  purchase_price_paise: money.default(0),
  selling_price_paise: money,
  mrp_paise: money.default(0),
  tax_mode: z.enum(['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT']).default('INCLUSIVE'),
  gst_bps: z.number().int().safe().min(0).max(10000).optional(),
  min_stock: z.number().int().safe().min(0).default(0),
  max_stock: z.number().int().safe().min(0).optional().nullable(),
  reorder_level: z.number().int().safe().min(0).default(0),
  reorder_quantity: z.number().int().safe().min(0).default(0),
  safety_stock: z.number().int().safe().min(0).default(0),
  rack: z.string().optional().nullable(),
  shelf: z.string().optional().nullable(),
  bin: z.string().optional().nullable(),
  preferred_supplier_id: z.string().uuid().optional().nullable(),
  warranty_months: z.number().int().safe().min(0).default(0),
  notes: z.string().optional().nullable(),
  active: z.boolean().default(true),
  opening_stock: z.number().int().safe().min(0).default(0),
});
catalogRouter.get(
  '/categories',
  wrap(async (req, res) => {
    const all = req.query.all === 'true';
    if (all) requireAdmin(req);
    res.json(
      (
        await pool.query(
          'SELECT * FROM categories WHERE $1::boolean OR active=true ORDER BY name',
          [all],
        )
      ).rows,
    );
  }),
);
catalogRouter.post(
  '/categories',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z.object({ name: z.string().min(2) }).parse(req.body);
    const row = (
      await pool.query('INSERT INTO categories(name) VALUES($1) RETURNING *', [input.name])
    ).rows[0];
    await audit(pool, actor.id, 'CREATE', 'category', row.id);
    res.status(201).json(row);
  }),
);
catalogRouter.patch(
  '/categories/:id',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({ name: z.string().min(2).optional(), active: z.boolean().optional() })
        .parse(req.body);
    const keys = Object.keys(input);
    if (!keys.length) throw new HttpError(400, 'No changes supplied.');
    const row = (
      await pool.query(
        `UPDATE categories SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`,
        [req.params.id, ...keys.map((k) => (input as any)[k])],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'Category not found.');
    await audit(pool, actor.id, 'UPDATE', 'category', row.id, { fields: keys });
    res.json(row);
  }),
);
catalogRouter.get(
  '/parts',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim(),
      category = String(req.query.category || ''),
      page = Math.max(1, Number(req.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = await pool.query(
      `SELECT p.id,p.name,p.short_name,p.internal_id,p.oem_number,p.sku,p.barcode,p.brand,p.part_type,
    p.unit,p.hsn,p.selling_price_paise,p.mrp_paise,p.tax_mode,p.gst_bps,p.current_stock,p.reserved_stock,
    p.current_stock-p.reserved_stock AS available_stock,p.damaged_stock,p.min_stock,p.reorder_level,
    p.rack,p.shelf,p.bin,p.active,p.category_id,c.name category
    FROM parts p LEFT JOIN categories c ON c.id=p.category_id
    WHERE ($1='' OR p.name ILIKE '%'||$1||'%' OR p.short_name ILIKE '%'||$1||'%' OR p.sku ILIKE '%'||$1||'%'
      OR p.oem_number ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM product_codes pc WHERE pc.part_id=p.id AND pc.normalized_code=$1 AND pc.is_active)
      OR p.name ILIKE '%'||replace($1,' ','%')||'%' OR similarity(p.name,$1)>0.25)
      AND ($2='' OR p.category_id::text=$2) AND ($3<>'true' OR p.active=true)
    ORDER BY CASE WHEN EXISTS(SELECT 1 FROM product_codes pc WHERE pc.part_id=p.id AND pc.normalized_code=$1 AND pc.is_active) THEN 0 WHEN p.sku=$1 OR p.oem_number=$1 THEN 1 ELSE 2 END,
      CASE WHEN $1<>'' THEN similarity(p.name,$1) ELSE 0 END DESC,p.name LIMIT $4 OFFSET $5`,
      [q, category, String(req.query.activeOnly || ''), limit, (page - 1) * limit],
    );
    res.json(rows.rows);
  }),
);
catalogRouter.get(
  '/parts/export',
  wrap(async (req, res) => {
    requireAdmin(req);
    const rows = (
      await pool.query(`SELECT p.name,p.sku,p.oem_number,pc.code,pc.code_type,
    (SELECT code FROM product_codes qr WHERE qr.part_id=p.id AND qr.is_active AND qr.code_type='QR_CODE' ORDER BY qr.is_primary DESC,qr.created_at LIMIT 1) qr_identifier
    FROM parts p LEFT JOIN product_codes pc ON pc.part_id=p.id AND pc.is_active AND pc.is_primary ORDER BY p.name`)
    ).rows;
    res
      .type('text/csv')
      .setHeader('Content-Disposition', 'attachment; filename="sam-product-codes.csv"');
    res.send(
      stringify(rows, {
        header: true,
        escape_formulas: true,
        columns: {
          name: 'Part Name',
          sku: 'SKU',
          oem_number: 'OEM Number',
          code: 'Primary Barcode',
          code_type: 'Barcode Type',
          qr_identifier: 'QR Identifier',
        },
      }),
    );
  }),
);
catalogRouter.get(
  '/parts/:id',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const part = await one(
      pool,
      `SELECT p.*,c.name category,p.current_stock-p.reserved_stock available_stock
    FROM parts p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1`,
      [req.params.id],
    );
    const [ledger, compatibility, purchases, sales, priceHistory, warranties] = await Promise.all([
      pool.query(
        'SELECT * FROM stock_transactions WHERE part_id=$1 ORDER BY created_at DESC LIMIT 100',
        [part.id],
      ),
      pool.query(
        'SELECT vc.* FROM part_compatibility pc JOIN vehicle_configurations vc ON vc.id=pc.configuration_id WHERE pc.part_id=$1',
        [part.id],
      ),
      pool.query(
        'SELECT p.purchase_number,p.created_at,pl.rate_paise,pl.quantity_received,s.name supplier FROM purchase_lines pl JOIN purchases p ON p.id=pl.purchase_id JOIN suppliers s ON s.id=p.supplier_id WHERE pl.part_id=$1 ORDER BY p.created_at DESC LIMIT 30',
        [part.id],
      ),
      pool.query(
        'SELECT i.invoice_number,i.created_at,il.quantity,il.rate_paise FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE il.part_id=$1 ORDER BY i.created_at DESC LIMIT 30',
        [part.id],
      ),
      pool.query(
        `SELECT ph.*,u.name changed_by_name FROM part_price_history ph LEFT JOIN users u ON u.id=ph.changed_by
      WHERE ph.part_id=$1 ORDER BY ph.changed_at DESC LIMIT 50`,
        [part.id],
      ),
      pool.query(
        `SELECT w.claim_number,w.status,w.complaint,w.created_at FROM warranty_claims w
      WHERE w.part_id=$1 ORDER BY w.created_at DESC LIMIT 30`,
        [part.id],
      ),
    ]);
    if (actor.role !== 'ADMIN') {
      delete part.purchase_price_paise;
      delete part.preferred_supplier_id;
    }
    res.json({
      ...part,
      ledger: ledger.rows,
      compatibility: compatibility.rows,
      purchases: actor.role === 'ADMIN' ? purchases.rows : [],
      sales: sales.rows,
      priceHistory: actor.role === 'ADMIN' ? priceHistory.rows : [],
      warranties: warranties.rows,
    });
  }),
);
catalogRouter.post(
  '/parts',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = partInput.parse(req.body);
    const result = await tx(async (db) => {
      if (input.gst_bps === undefined) {
        const settings = await one(db, 'SELECT default_gst_bps FROM business_settings WHERE id=1');
        input.gst_bps = Number(settings.default_gst_bps);
      }
      const keys = Object.keys(input).filter(
        (k) => !['opening_stock', 'codes', 'barcode'].includes(k),
      );
      const values = keys.map((k) => (input as any)[k]);
      const row = (
        await db.query(
          `INSERT INTO parts(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
          values,
        )
      ).rows[0];
      const codes = [...input.codes];
      if (input.barcode?.trim())
        codes.unshift(
          codeInput.parse({ code: input.barcode, is_primary: !codes.some((c) => c.is_primary) }),
        );
      if (codes.filter((c) => c.is_primary).length > 1)
        throw new HttpError(400, 'Choose only one primary code.');
      for (const code of codes.sort((a, b) => a.code.localeCompare(b.code)))
        await assignCode(db, row.id, code, actor.id);
      if (input.opening_stock)
        await db.query(
          `SELECT move_stock($1,'OPENING_STOCK',$2,0,0,'PART',$3,$4,'Opening stock')`,
          [row.id, input.opening_stock, row.id, actor.id],
        );
      await db.query('UPDATE parts SET opening_stock=$2 WHERE id=$1', [
        row.id,
        input.opening_stock,
      ]);
      await audit(db, actor.id, 'CREATE', 'part', row.id);
      return row;
    });
    res.status(201).json(result);
  }),
);
catalogRouter.patch(
  '/parts/:id',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = partInput.omit({ opening_stock: true, codes: true }).partial().parse(req.body);
    const keys = Object.keys(input).filter((k) => k !== 'barcode');
    if (!Object.keys(input).length) throw new HttpError(400, 'No changes supplied.');
    const row = await tx(async (db) => {
      const old = await one(db, 'SELECT * FROM parts WHERE id=$1 FOR UPDATE', [req.params.id]);
      const updated = keys.length
        ? (
            await db.query(
              `UPDATE parts SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')},updated_at=now() WHERE id=$1 RETURNING *`,
              [req.params.id, ...keys.map((k) => (input as any)[k])],
            )
          ).rows[0]
        : old;
      if (input.barcode !== undefined)
        await changeLegacyBarcode(db, old.id, input.barcode, actor.id);
      if (
        ['purchase_price_paise', 'selling_price_paise', 'mrp_paise'].some(
          (k) => Number(old[k]) !== Number(updated[k]),
        )
      )
        await db.query(
          `INSERT INTO part_price_history(part_id,old_purchase_paise,new_purchase_paise,
        old_selling_paise,new_selling_paise,old_mrp_paise,new_mrp_paise,source,changed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,'PART_EDIT',$8)`,
          [
            updated.id,
            old.purchase_price_paise,
            updated.purchase_price_paise,
            old.selling_price_paise,
            updated.selling_price_paise,
            old.mrp_paise,
            updated.mrp_paise,
            actor.id,
          ],
        );
      await audit(db, actor.id, 'UPDATE', 'part', updated.id, { fields: keys });
      return updated;
    });
    res.json(row);
  }),
);
catalogRouter.post(
  '/parts/:id/compatibility',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({ configuration_id: z.string().uuid(), remarks: z.string().optional() })
        .parse(req.body);
    await pool.query(
      'INSERT INTO part_compatibility(part_id,configuration_id,remarks) VALUES($1,$2,$3) ON CONFLICT(part_id,configuration_id) DO UPDATE SET remarks=excluded.remarks',
      [req.params.id, input.configuration_id, input.remarks || null],
    );
    await audit(pool, actor.id, 'LINK', 'part_compatibility', req.params.id, input);
    res.status(201).json({ ok: true });
  }),
);
catalogRouter.get(
  '/stock',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const status = String(req.query.status || '');
    const rows = await pool.query(
      `SELECT p.id,p.name,p.sku,p.oem_number,p.brand,p.current_stock,p.reserved_stock,
    p.current_stock-p.reserved_stock available_stock,p.damaged_stock,p.returned_stock,p.min_stock,p.reorder_level,
    p.reorder_quantity,p.purchase_price_paise,p.current_stock*p.purchase_price_paise stock_value_paise,p.rack,p.last_stock_at
    FROM parts p WHERE p.active=true AND ($1='' OR ($1='LOW' AND p.current_stock-p.reserved_stock<=p.min_stock)
    OR ($1='OUT' AND p.current_stock-p.reserved_stock=0)) ORDER BY p.name LIMIT 500`,
      [status],
    );
    if (actor.role !== 'ADMIN')
      for (const row of rows.rows) {
        delete row.purchase_price_paise;
        delete row.stock_value_paise;
      }
    res.json(rows.rows);
  }),
);
catalogRouter.get(
  '/stock/ledger',
  wrap(async (req, res) => {
    const rows = await pool.query(
      `SELECT st.*,p.name part_name,p.sku,u.name user_name FROM stock_transactions st
    JOIN parts p ON p.id=st.part_id LEFT JOIN users u ON u.id=st.user_id
    WHERE ($1='' OR st.part_id::text=$1) ORDER BY st.created_at DESC LIMIT 300`,
      [String(req.query.partId || '')],
    );
    res.json(rows.rows);
  }),
);
catalogRouter.get(
  '/stock/reservations',
  wrap(async (req, res) => {
    requireAdmin(req);
    res.json(
      (
        await pool.query(`SELECT sr.*,p.name part_name,p.sku,u.name created_by_name
    FROM stock_reservations sr JOIN parts p ON p.id=sr.part_id JOIN users u ON u.id=sr.created_by
    WHERE sr.released_quantity<sr.quantity ORDER BY sr.created_at DESC LIMIT 100`)
      ).rows,
    );
  }),
);
catalogRouter.post(
  '/stock/reservations',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          part_id: z.string().uuid(),
          quantity: z.number().int().safe().positive(),
          reference: z.string().min(2),
          reason: z.string().min(5),
        })
        .parse(req.body);
    const result = await tx(async (db) => {
      const row = (
        await db.query(
          `INSERT INTO stock_reservations(part_id,quantity,reference,reason,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [input.part_id, input.quantity, input.reference, input.reason, actor.id],
        )
      ).rows[0];
      await db.query(`SELECT move_stock($1,'RESERVED',0,$2,0,'RESERVATION',$3,$4,$5)`, [
        input.part_id,
        input.quantity,
        row.id,
        actor.id,
        input.reason,
      ]);
      await audit(db, actor.id, 'RESERVE', 'part', input.part_id, {
        reservationId: row.id,
        quantity: input.quantity,
      });
      return row;
    });
    res.status(201).json(result);
  }),
);
catalogRouter.post(
  '/stock/reservations/:id/release',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({ quantity: z.number().int().safe().positive(), reason: z.string().min(5) })
        .parse(req.body);
    const result = await tx(async (db) => {
      const reservation = await one(db, 'SELECT * FROM stock_reservations WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      if (Number(reservation.released_quantity) + input.quantity > Number(reservation.quantity))
        throw new HttpError(409, 'Release exceeds remaining reservation.');
      await db.query(
        `UPDATE stock_reservations SET released_quantity=released_quantity+$2 WHERE id=$1`,
        [reservation.id, input.quantity],
      );
      await db.query(`SELECT move_stock($1,'RESERVATION_RELEASED',0,$2,0,'RESERVATION',$3,$4,$5)`, [
        reservation.part_id,
        -input.quantity,
        reservation.id,
        actor.id,
        input.reason,
      ]);
      await audit(db, actor.id, 'RELEASE', 'reservation', reservation.id, {
        quantity: input.quantity,
      });
      return { released: input.quantity };
    });
    res.json(result);
  }),
);
catalogRouter.post(
  '/stock/adjustments',
  wrap(async (req, res) => {
    const actor = requireAdmin(req);
    const input = z
      .object({
        part_id: z.string().uuid(),
        delta: z
          .number()
          .int()
          .refine((v) => v !== 0),
        reason: z.string().min(5),
      })
      .parse(req.body);
    await tx(async (db) => {
      await db.query(`SELECT move_stock($1,$2,$3,0,0,'ADJUSTMENT',$4,$5,$6)`, [
        input.part_id,
        input.delta > 0 ? 'STOCK_ADJUSTMENT_INCREASE' : 'STOCK_ADJUSTMENT_DECREASE',
        input.delta,
        randomUUID(),
        actor.id,
        input.reason,
      ]);
      await audit(db, actor.id, 'ADJUST', 'part', input.part_id, {
        delta: input.delta,
        reason: input.reason,
      });
    });
    res.status(201).json({ ok: true });
  }),
);
