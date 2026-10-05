import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, tx, one, audit, HttpError } from './db.js';
import { wrap, requireActor, requireAdmin } from './http.js';
import { warrantyWindow } from './warranty.js';

export const operationsRouter = Router();
operationsRouter.get(
  '/notifications',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const [stock, warranty, overdue, expected] = await Promise.all([
      pool.query(`SELECT count(*) FILTER (WHERE current_stock-reserved_stock=0) out_count,
      count(*) FILTER (WHERE current_stock-reserved_stock>0 AND current_stock-reserved_stock<=min_stock) low_count
      FROM parts WHERE active=true`),
      pool.query(
        "SELECT count(*) count FROM warranty_claims WHERE status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REPLACEMENT_ORDERED','REPLACEMENT_RECEIVED')",
      ),
      pool.query(
        "SELECT count(*) count FROM invoices WHERE status=$1 AND pending_paise>0 AND due_date<(now() AT TIME ZONE 'Asia/Kolkata')::date",
        ['COMPLETED'],
      ),
      pool.query(
        "SELECT count(*) count FROM purchases WHERE status IN ('ORDERED','PARTIALLY_RECEIVED') AND expected_date<=(now() AT TIME ZONE 'Asia/Kolkata')::date+3",
      ),
    ]);
    const notices = [] as {
      id: string;
      title: string;
      detail: string;
      target: string;
      severity: string;
    }[];
    if (Number(stock.rows[0].out_count))
      notices.push({
        id: 'out',
        title: 'Out of stock',
        detail: `${stock.rows[0].out_count} parts need replenishment`,
        target: 'stock',
        severity: 'bad',
      });
    if (Number(stock.rows[0].low_count))
      notices.push({
        id: 'low',
        title: 'Low stock',
        detail: `${stock.rows[0].low_count} parts are at or below minimum`,
        target: 'stock',
        severity: 'warn',
      });
    if (Number(warranty.rows[0].count))
      notices.push({
        id: 'warranty',
        title: 'Warranty claims',
        detail: `${warranty.rows[0].count} claims need attention`,
        target: 'warranty',
        severity: 'warn',
      });
    if (Number(overdue.rows[0].count))
      notices.push({
        id: 'credit',
        title: 'Overdue customer credit',
        detail: `${overdue.rows[0].count} invoices are overdue`,
        target: 'customers',
        severity: 'warn',
      });
    if (actor.role === 'ADMIN' && Number(expected.rows[0].count))
      notices.push({
        id: 'purchase',
        title: 'Purchases expected',
        detail: `${expected.rows[0].count} orders are due soon`,
        target: 'purchases',
        severity: 'neutral',
      });
    res.json(notices);
  }),
);
operationsRouter.get(
  '/search',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const q = String(req.query.q || '').trim();
    if (q.length < 2)
      return res.json({ parts: [], customers: [], vehicles: [], invoices: [], suppliers: [] });
    const [parts, customers, vehicles, invoices, suppliers] = await Promise.all([
      pool.query(
        "SELECT p.id,p.name,p.sku,p.oem_number FROM parts p WHERE p.name ILIKE '%'||$1||'%' OR p.sku ILIKE '%'||$1||'%' OR p.oem_number ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM product_codes pc WHERE pc.part_id=p.id AND pc.normalized_code=$1 AND pc.is_active) ORDER BY CASE WHEN EXISTS(SELECT 1 FROM product_codes pc WHERE pc.part_id=p.id AND pc.normalized_code=$1 AND pc.is_active) THEN 0 ELSE 1 END,p.name LIMIT 6",
        [q],
      ),
      pool.query(
        "SELECT id,name,phone FROM customers WHERE name ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%' LIMIT 6",
        [q],
      ),
      pool.query(
        "SELECT id,registration_number,chassis_number,vin FROM customer_vehicles WHERE registration_number ILIKE '%'||$1||'%' OR chassis_number ILIKE '%'||$1||'%' OR vin ILIKE '%'||$1||'%' LIMIT 6",
        [q],
      ),
      pool.query(
        "SELECT id,invoice_number FROM invoices WHERE invoice_number ILIKE '%'||$1||'%' LIMIT 6",
        [q],
      ),
      pool.query("SELECT id,name FROM suppliers WHERE name ILIKE '%'||$1||'%' LIMIT 6", [q]),
    ]);
    res.json({
      parts: parts.rows,
      customers: customers.rows,
      vehicles: vehicles.rows,
      invoices: invoices.rows,
      suppliers: actor.role === 'ADMIN' ? suppliers.rows : [],
    });
  }),
);
operationsRouter.get(
  '/warranty',
  wrap(async (req, res) => {
    const q = String(req.query.q || '');
    res.json(
      (
        await pool.query(
          `SELECT w.*,p.name part_name,i.invoice_number,c.name customer_name,v.registration_number
    FROM warranty_claims w JOIN parts p ON p.id=w.part_id JOIN invoice_lines il ON il.id=w.invoice_line_id
    JOIN invoices i ON i.id=il.invoice_id LEFT JOIN customers c ON c.id=w.customer_id
    LEFT JOIN customer_vehicles v ON v.id=w.vehicle_id
    WHERE $1='' OR w.claim_number ILIKE '%'||$1||'%' OR i.invoice_number ILIKE '%'||$1||'%'
    OR v.registration_number ILIKE '%'||$1||'%' ORDER BY w.created_at DESC LIMIT 100`,
          [q],
        )
      ).rows,
    );
  }),
);
operationsRouter.post(
  '/warranty',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = z
        .object({
          invoice_line_id: z.string().uuid(),
          serial_number: z.string().optional(),
          complaint: z.string().min(5),
          remarks: z.string().optional(),
        })
        .parse(req.body);
    const result = await tx(async (db) => {
      const line = await one(
        db,
        `SELECT il.*,i.customer_id,i.vehicle_id,i.created_at sale_date,i.status invoice_status
      FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE il.id=$1`,
        [input.invoice_line_id],
      );
      if (line.invoice_status !== 'COMPLETED')
        throw new HttpError(409, 'Original invoice is not active.');
      if (Number(line.warranty_months) <= 0)
        throw new HttpError(409, 'This part has no warranty period.');
      const { start, end, expired } = warrantyWindow(
        new Date(line.sale_date),
        Number(line.warranty_months),
      );
      if (expired) throw new HttpError(409, 'Warranty period has expired.');
      const number = `WC-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const row = (
        await db.query(
          `INSERT INTO warranty_claims(claim_number,invoice_line_id,customer_id,vehicle_id,part_id,
      serial_number,warranty_start,warranty_end,complaint,remarks,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            number,
            line.id,
            line.customer_id,
            line.vehicle_id,
            line.part_id,
            input.serial_number || null,
            start,
            end,
            input.complaint,
            input.remarks || null,
            actor.id,
          ],
        )
      ).rows[0];
      await audit(db, actor.id, 'CREATE', 'warranty', row.id);
      return row;
    });
    res.status(201).json(result);
  }),
);
operationsRouter.patch(
  '/warranty/:id',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          status: z.enum([
            'DRAFT',
            'SUBMITTED',
            'UNDER_REVIEW',
            'APPROVED',
            'REJECTED',
            'REPLACEMENT_ORDERED',
            'REPLACEMENT_RECEIVED',
            'COMPLETED',
          ]),
          replacement_part_id: z.string().uuid().optional(),
          remarks: z.string().optional(),
        })
        .parse(req.body);
    const row = (
      await pool.query(
        `UPDATE warranty_claims SET status=$2,replacement_part_id=coalesce($3,replacement_part_id),
    remarks=coalesce($4,remarks),submitted_at=CASE WHEN $2='SUBMITTED' THEN now() ELSE submitted_at END
    WHERE id=$1 RETURNING *`,
        [req.params.id, input.status, input.replacement_part_id || null, input.remarks || null],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'Claim not found.');
    await audit(pool, actor.id, 'UPDATE', 'warranty', row.id, { status: input.status });
    res.json(row);
  }),
);
operationsRouter.get(
  '/expenses',
  wrap(async (req, res) => {
    requireAdmin(req);
    const from = String(req.query.from || '1970-01-01'),
      to = String(req.query.to || '9999-12-31');
    res.json(
      (
        await pool.query(
          'SELECT e.*,u.name added_by FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE expense_date BETWEEN $1 AND $2 ORDER BY expense_date DESC LIMIT 300',
          [from, to],
        )
      ).rows,
    );
  }),
);
operationsRouter.post(
  '/expenses',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          expense_date: z.string(),
          category: z.string().min(2),
          description: z.string().min(2),
          amount_paise: z.number().int().safe().positive(),
          payment_mode: z.string().min(2),
          vendor: z.string().optional(),
          reference: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(req.body);
    const keys = Object.keys(input),
      row = (
        await pool.query(
          `INSERT INTO expenses(${keys.join(',')},created_by) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')},$${keys.length + 1}) RETURNING *`,
          [...keys.map((k) => (input as any)[k]), actor.id],
        )
      ).rows[0];
    await audit(pool, actor.id, 'CREATE', 'expense', row.id);
    res.status(201).json(row);
  }),
);
operationsRouter.get(
  '/settings',
  wrap(async (req, res) => {
    requireAdmin(req);
    res.json(await one(pool, 'SELECT * FROM business_settings WHERE id=1'));
  }),
);
operationsRouter.patch(
  '/settings',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          name: z.string().min(2),
          address: z.string(),
          phone: z.string(),
          email: z.string(),
          gstin: z.string(),
          state: z.string(),
          invoice_prefix: z
            .string()
            .min(1)
            .max(12)
            .regex(/^[A-Z0-9-]+$/),
          default_gst_bps: z.number().int().safe().min(0).max(10000),
          invoice_footer: z.string(),
          terms: z.string(),
          paper_format: z.enum(['A4', 'COMPACT']),
        })
        .partial()
        .parse(req.body);
    const keys = Object.keys(input);
    if (!keys.length) throw new HttpError(400, 'No changes supplied.');
    const row = (
      await pool.query(
        `UPDATE business_settings SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')},updated_at=now() WHERE id=1 RETURNING *`,
        keys.map((k) => (input as any)[k]),
      )
    ).rows[0];
    await audit(pool, actor.id, 'UPDATE', 'settings', '1', { fields: keys });
    res.json(row);
  }),
);
operationsRouter.get(
  '/audit',
  wrap(async (req, res) => {
    requireAdmin(req);
    res.json(
      (
        await pool.query(
          `SELECT a.*,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300`,
        )
      ).rows,
    );
  }),
);
operationsRouter.get(
  '/dashboard',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const [sales, purchases, parts, finance, claims, low, recent, partsSold] = await Promise.all([
      pool.query(`SELECT coalesce(sum(amount),0) today_paise,coalesce(sum(invoice_count),0) invoices FROM (
      SELECT total_paise amount,1 invoice_count,created_at FROM invoices WHERE status='COMPLETED'
      UNION ALL
      SELECT -srl.amount_paise amount,0 invoice_count,sr.created_at FROM sales_return_lines srl
      JOIN sales_returns sr ON sr.id=srl.return_id JOIN invoices i ON i.id=sr.invoice_id WHERE i.status='COMPLETED'
    ) events WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=(now() AT TIME ZONE 'Asia/Kolkata')::date`),
      pool.query(`SELECT coalesce(sum(value_paise),0) today_paise FROM purchase_receipts
      WHERE (received_at AT TIME ZONE 'Asia/Kolkata')::date=(now() AT TIME ZONE 'Asia/Kolkata')::date`),
      pool.query(`SELECT count(*) total,count(*) FILTER (WHERE current_stock-reserved_stock<=min_stock) low,
      count(*) FILTER (WHERE current_stock-reserved_stock=0) out_of_stock,
      coalesce(sum(current_stock*purchase_price_paise),0) stock_value_paise FROM parts WHERE active=true`),
      pool.query(`SELECT (SELECT coalesce(sum(outstanding_paise),0) FROM customers) receivable_paise,
      (SELECT coalesce(sum(outstanding_paise),0) FROM suppliers) payable_paise`),
      pool.query(
        "SELECT count(*) pending FROM warranty_claims WHERE status NOT IN ('COMPLETED','REJECTED')",
      ),
      pool.query(`SELECT id,name,sku,current_stock,reserved_stock,min_stock,reorder_quantity FROM parts
      WHERE active=true AND current_stock-reserved_stock<=min_stock ORDER BY current_stock-reserved_stock LIMIT 10`),
      pool.query(`SELECT i.id,i.invoice_number,i.total_paise,i.created_at,c.name customer_name
      FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id ORDER BY i.created_at DESC LIMIT 8`),
      pool.query(`SELECT coalesce(sum(quantity),0) quantity FROM (
      SELECT il.quantity quantity,i.created_at FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id WHERE i.status='COMPLETED'
      UNION ALL
      SELECT -srl.quantity quantity,sr.created_at FROM sales_return_lines srl JOIN sales_returns sr ON sr.id=srl.return_id
      JOIN invoices i ON i.id=sr.invoice_id WHERE i.status='COMPLETED'
    ) movements WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=(now() AT TIME ZONE 'Asia/Kolkata')::date`),
    ]);
    if (actor.role !== 'ADMIN') delete parts.rows[0].stock_value_paise;
    res.json({
      sales: { ...sales.rows[0], parts_sold: partsSold.rows[0].quantity },
      purchases: actor.role === 'ADMIN' ? purchases.rows[0] : null,
      parts: parts.rows[0],
      finance: actor.role === 'ADMIN' ? finance.rows[0] : null,
      claims: claims.rows[0],
      lowStock: low.rows,
      recentInvoices: recent.rows,
    });
  }),
);
operationsRouter.get(
  '/reports/sales',
  wrap(async (req, res) => {
    requireAdmin(req);
    const from = String(req.query.from || '1970-01-01'),
      to = String(req.query.to || '9999-12-31');
    res.json(
      (
        await pool.query(
          `WITH events AS (
    SELECT i.created_at,1 invoice_count,i.total_paise sales_paise,i.taxable_paise,i.cgst_paise,
      i.sgst_paise,i.igst_paise,i.pending_paise FROM invoices i WHERE i.status='COMPLETED'
    UNION ALL
    SELECT sr.created_at,0,-srl.amount_paise,
      -coalesce(round(srl.amount_paise::numeric*i.taxable_paise/nullif(i.total_paise,0)),0)::bigint,
      -coalesce(round(srl.amount_paise::numeric*i.cgst_paise/nullif(i.total_paise,0)),0)::bigint,
      -coalesce(round(srl.amount_paise::numeric*i.sgst_paise/nullif(i.total_paise,0)),0)::bigint,
      -coalesce(round(srl.amount_paise::numeric*i.igst_paise/nullif(i.total_paise,0)),0)::bigint,0
    FROM sales_return_lines srl JOIN sales_returns sr ON sr.id=srl.return_id
    JOIN invoices i ON i.id=sr.invoice_id WHERE i.status='COMPLETED'
  ) SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS "day",sum(invoice_count) invoice_count,
    sum(sales_paise) sales_paise,sum(taxable_paise) taxable_paise,sum(cgst_paise) cgst_paise,
    sum(sgst_paise) sgst_paise,sum(igst_paise) igst_paise,sum(pending_paise) pending_paise
    FROM events WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
    GROUP BY 1 ORDER BY 1 DESC`,
          [from, to],
        )
      ).rows,
    );
  }),
);
operationsRouter.get(
  '/reports/finance',
  wrap(async (req, res) => {
    requireAdmin(req);
    const from = String(req.query.from || '1970-01-01'),
      to = String(req.query.to || '9999-12-31');
    const [sales, returns, purchases, expenses, receivables, payables] = await Promise.all([
      pool.query(
        `SELECT coalesce(sum(total_paise),0) value FROM invoices WHERE status='COMPLETED'
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`,
        [from, to],
      ),
      pool.query(
        `SELECT coalesce(sum(srl.amount_paise),0) value FROM sales_return_lines srl
      JOIN sales_returns sr ON sr.id=srl.return_id WHERE (sr.created_at AT TIME ZONE 'Asia/Kolkata')::date
      BETWEEN $1::date AND $2::date`,
        [from, to],
      ),
      pool.query(
        `SELECT coalesce(sum(value_paise),0) value FROM purchase_receipts
      WHERE (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`,
        [from, to],
      ),
      pool.query(
        'SELECT coalesce(sum(amount_paise),0) value FROM expenses WHERE expense_date BETWEEN $1::date AND $2::date',
        [from, to],
      ),
      pool.query(`SELECT id,name,outstanding_paise FROM customers WHERE outstanding_paise>0
      ORDER BY outstanding_paise DESC LIMIT 20`),
      pool.query(`SELECT id,name,outstanding_paise,credit_balance_paise FROM suppliers
      WHERE outstanding_paise>0 OR credit_balance_paise>0 ORDER BY outstanding_paise DESC LIMIT 20`),
    ]);
    res.json({
      sales_paise: Number(sales.rows[0].value) - Number(returns.rows[0].value),
      purchases_paise: purchases.rows[0].value,
      expenses_paise: expenses.rows[0].value,
      receivables: receivables.rows,
      payables: payables.rows,
    });
  }),
);
operationsRouter.get(
  '/reports/stock',
  wrap(async (req, res) => {
    requireAdmin(req);
    const days = Math.max(1, Math.min(3650, Number(req.query.deadDays) || 90));
    res.json(
      (
        await pool.query(
          `SELECT p.id,p.name,p.sku,p.current_stock,p.current_stock*p.purchase_price_paise value_paise,
    max(st.created_at) FILTER (WHERE st.type='SALE') last_sale_at
    FROM parts p LEFT JOIN stock_transactions st ON st.part_id=p.id WHERE p.active=true
    GROUP BY p.id HAVING max(st.created_at) FILTER (WHERE st.type='SALE') IS NULL
      OR max(st.created_at) FILTER (WHERE st.type='SALE') < now()-($1::int*interval '1 day')
    ORDER BY value_paise DESC LIMIT 200`,
          [days],
        )
      ).rows,
    );
  }),
);
operationsRouter.get(
  '/reports/top-parts',
  wrap(async (req, res) => {
    requireAdmin(req);
    res.json(
      (
        await pool.query(`SELECT p.id,p.name,p.sku,sum(il.quantity-il.returned_quantity) quantity_sold,
    sum(coalesce(round(il.total_paise::numeric*i.total_paise/nullif(ig.gross,0)),0)::bigint-
      coalesce(r.returned_paise,0)) net_paise
    FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id JOIN parts p ON p.id=il.part_id
    JOIN (SELECT invoice_id,sum(total_paise) gross FROM invoice_lines GROUP BY invoice_id) ig ON ig.invoice_id=i.id
    LEFT JOIN (SELECT invoice_line_id,sum(amount_paise) returned_paise FROM sales_return_lines GROUP BY invoice_line_id) r
      ON r.invoice_line_id=il.id
    WHERE i.status='COMPLETED' AND i.created_at>=now()-interval '90 days'
    GROUP BY p.id HAVING sum(il.quantity-il.returned_quantity)>0
    ORDER BY quantity_sold DESC LIMIT 25`)
      ).rows,
    );
  }),
);
operationsRouter.get(
  '/reports/margins',
  wrap(async (req, res) => {
    requireAdmin(req);
    const from = String(req.query.from || '1970-01-01'),
      to = String(req.query.to || '9999-12-31');
    res.json(
      (
        await pool.query(
          `WITH invoice_taxable AS (
    SELECT invoice_id,sum(taxable_paise) amount FROM invoice_lines GROUP BY invoice_id
  ), line_margin AS (
    SELECT p.id,p.name,p.sku,(i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS event_day,
      coalesce(round(il.taxable_paise::numeric*i.taxable_paise/nullif(it.amount,0)),0)::bigint taxable,
      il.quantity*il.cost_paise cogs
    FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id JOIN parts p ON p.id=il.part_id
    JOIN invoice_taxable it ON it.invoice_id=i.id WHERE i.status='COMPLETED'
    UNION ALL
    SELECT p.id,p.name,p.sku,(sr.created_at AT TIME ZONE 'Asia/Kolkata')::date AS event_day,
      -coalesce(round(srl.amount_paise::numeric*i.taxable_paise/nullif(i.total_paise,0)),0)::bigint taxable,
      -srl.quantity*il.cost_paise cogs
    FROM sales_return_lines srl JOIN sales_returns sr ON sr.id=srl.return_id
    JOIN invoice_lines il ON il.id=srl.invoice_line_id JOIN invoices i ON i.id=sr.invoice_id
    JOIN parts p ON p.id=il.part_id WHERE i.status='COMPLETED'
  ) SELECT id,name,sku,sum(taxable) taxable_paise,sum(cogs) cogs_paise,
    sum(taxable)-sum(cogs) margin_paise,
    CASE WHEN sum(taxable)>0 THEN round((sum(taxable)-sum(cogs))*10000.0/sum(taxable)) ELSE 0 END margin_bps
    FROM line_margin WHERE event_day BETWEEN $1::date AND $2::date
    GROUP BY id,name,sku HAVING sum(taxable)<>0 OR sum(cogs)<>0
    ORDER BY margin_paise DESC LIMIT 100`,
          [from, to],
        )
      ).rows,
    );
  }),
);
