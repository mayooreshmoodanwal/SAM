import { Router } from 'express';
import { z } from 'zod';
import { pool, tx, one, audit, HttpError } from './db.js';
import { wrap, requireActor, requireAdmin } from './http.js';
import { calculateLine, calculateInvoice, financialYear } from './tax.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { shopDate } from './dates.js';

export const billingRouter = Router();
const saleInput = z.object({
  customer_id: z.string().uuid().optional().nullable(),
  vehicle_id: z.string().uuid().optional().nullable(),
  interstate: z.boolean().default(false),
  place_of_supply: z.string().optional(),
  remarks: z.string().optional(),
  credit_override: z.boolean().default(false),
  invoice_discount_paise: z.number().int().safe().min(0).default(0),
  lines: z
    .array(
      z.object({
        part_id: z.string().uuid(),
        quantity: z.number().int().safe().positive(),
        scanned_code_id: z.string().uuid().optional().nullable(),
        added_via: z
          .enum([
            'MANUAL_PRODUCT_SELECTION',
            'HARDWARE_KEYBOARD',
            'HARDWARE_HID',
            'CAMERA',
            'MANUAL_CODE',
          ])
          .default('MANUAL_PRODUCT_SELECTION'),
        discount_paise: z.number().int().safe().min(0).default(0),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER']),
        amount_paise: z.number().int().safe().positive(),
        reference: z.string().optional(),
      }),
    )
    .default([]),
});
billingRouter.post(
  '/sales/quote',
  wrap(async (req, res) => {
    const input = saleInput.parse(req.body);
    const lines = [];
    for (const line of input.lines) {
      const part = await one(
        pool,
        'SELECT id,name,selling_price_paise,tax_mode,gst_bps,current_stock,reserved_stock FROM parts WHERE id=$1',
        [line.part_id],
      );
      lines.push({
        part_id: part.id,
        name: part.name,
        available_stock: Number(part.current_stock) - Number(part.reserved_stock),
        ...calculateLine({
          quantity: line.quantity,
          ratePaise: Number(part.selling_price_paise),
          discountPaise: line.discount_paise,
          taxMode: part.tax_mode,
          gstBps: Number(part.gst_bps),
        }),
      });
    }
    res.json({
      lines,
      totals: calculateInvoice(lines, input.invoice_discount_paise, input.interstate),
    });
  }),
);
billingRouter.get(
  '/sales/invoices',
  wrap(async (req, res) => {
    const q = String(req.query.q || ''),
      fy = String(req.query.financialYear || '');
    res.json(
      (
        await pool.query(
          `SELECT i.id,i.invoice_number,i.created_at,i.total_paise,i.paid_paise,i.pending_paise,i.status,
    c.name customer_name,v.registration_number FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
    LEFT JOIN customer_vehicles v ON v.id=i.vehicle_id WHERE ($1='' OR i.invoice_number ILIKE '%'||$1||'%' OR c.name ILIKE '%'||$1||'%')
    AND ($2='' OR i.financial_year=$2) ORDER BY i.created_at DESC LIMIT 100`,
          [q, fy],
        )
      ).rows,
    );
  }),
);
billingRouter.post(
  '/sales/invoices',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = saleInput.parse(req.body);
    if (new Set(input.lines.map((l) => l.part_id)).size !== input.lines.length)
      throw new HttpError(400, 'Combine duplicate parts into one invoice line.');
    const result = await tx(async (db) => {
      const customer = input.customer_id
        ? await one(db, 'SELECT * FROM customers WHERE id=$1 FOR UPDATE', [input.customer_id])
        : null;
      if (input.vehicle_id) {
        const v = await one(db, 'SELECT customer_id FROM customer_vehicles WHERE id=$1', [
          input.vehicle_id,
        ]);
        if (v.customer_id !== input.customer_id)
          throw new HttpError(400, 'Selected vehicle does not belong to this customer.');
      }
      const sorted = [...input.lines].sort((a, b) => a.part_id.localeCompare(b.part_id));
      const snapshots = [] as {
        part: any;
        quantity: number;
        discountPaise: number;
        total: ReturnType<typeof calculateLine>;
        scannedCodeId: string | null;
        addedVia: string;
      }[];
      for (const line of sorted) {
        const part = await one(db, 'SELECT * FROM parts WHERE id=$1 FOR UPDATE', [line.part_id]);
        if (!part.active) throw new HttpError(409, `${part.name} is inactive.`);
        const available = Number(part.current_stock) - Number(part.reserved_stock);
        if (line.quantity > available)
          throw new HttpError(409, `Only ${available} units of ${part.name} are available.`);
        if (line.scanned_code_id) {
          const code = await one(db, 'SELECT part_id FROM product_codes WHERE id=$1', [
            line.scanned_code_id,
          ]);
          if (code.part_id !== part.id)
            throw new HttpError(400, 'Scanned code does not belong to this invoice part.');
        }
        const total = calculateLine({
          quantity: line.quantity,
          ratePaise: Number(part.selling_price_paise),
          discountPaise: line.discount_paise,
          gstBps: Number(part.gst_bps),
          taxMode: part.tax_mode,
        });
        snapshots.push({
          part,
          quantity: line.quantity,
          discountPaise: line.discount_paise,
          scannedCodeId: line.scanned_code_id || null,
          addedVia: line.added_via,
          total,
        });
      }
      const totals = calculateInvoice(
        snapshots.map((s) => s.total),
        input.invoice_discount_paise,
        input.interstate,
      );
      const paid = input.payments.reduce((sum, p) => sum + p.amount_paise, 0);
      if (paid > totals.totalPaise) throw new HttpError(400, 'Payment exceeds invoice total.');
      const pending = totals.totalPaise - paid;
      if (pending && !customer) throw new HttpError(400, 'Select a customer for a credit sale.');
      if (
        customer &&
        pending &&
        Number(customer.outstanding_paise) + pending > Number(customer.credit_limit_paise) &&
        !(actor.role === 'ADMIN' && input.credit_override)
      ) {
        const excess =
          Number(customer.outstanding_paise) + pending - Number(customer.credit_limit_paise);
        throw new HttpError(
          409,
          `Customer credit limit would be exceeded by ₹${(excess / 100).toFixed(2)}.`,
        );
      }
      const fy = financialYear();
      await db.query(
        'INSERT INTO invoice_counters(financial_year,next_number) VALUES($1,1) ON CONFLICT DO NOTHING',
        [fy],
      );
      const counter = await one(
        db,
        'SELECT next_number FROM invoice_counters WHERE financial_year=$1 FOR UPDATE',
        [fy],
      );
      await db.query(
        'UPDATE invoice_counters SET next_number=next_number+1 WHERE financial_year=$1',
        [fy],
      );
      const setting = await one(db, 'SELECT invoice_prefix FROM business_settings WHERE id=1');
      const number = `${setting.invoice_prefix}/${fy}/${String(counter.next_number).padStart(6, '0')}`;
      const dueDate = customer?.credit_period_days
        ? shopDate(new Date(Date.now() + Number(customer.credit_period_days) * 86400000))
        : null;
      const invoice = (
        await db.query(
          `INSERT INTO invoices(invoice_number,financial_year,customer_id,vehicle_id,created_by,
      place_of_supply,interstate,subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,
      round_off_paise,total_paise,paid_paise,pending_paise,due_date,remarks)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
          [
            number,
            fy,
            input.customer_id || null,
            input.vehicle_id || null,
            actor.id,
            input.place_of_supply || null,
            input.interstate,
            totals.subtotalPaise,
            totals.discountPaise,
            totals.taxablePaise,
            totals.cgstPaise,
            totals.sgstPaise,
            totals.igstPaise,
            totals.roundOffPaise,
            totals.totalPaise,
            paid,
            pending,
            dueDate,
            input.remarks || null,
          ],
        )
      ).rows[0];
      for (const s of snapshots) {
        await db.query(
          `INSERT INTO invoice_lines(invoice_id,part_id,part_name,oem_number,sku,hsn,unit,quantity,mrp_paise,
        rate_paise,cost_paise,tax_mode,gst_bps,discount_paise,taxable_paise,gst_paise,total_paise,warranty_months,scanned_code_id,added_via)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            invoice.id,
            s.part.id,
            s.part.name,
            s.part.oem_number,
            s.part.sku,
            s.part.hsn,
            s.part.unit,
            s.quantity,
            s.part.mrp_paise,
            s.part.selling_price_paise,
            s.part.purchase_price_paise,
            s.part.tax_mode,
            s.part.gst_bps,
            s.discountPaise,
            s.total.taxablePaise,
            s.total.gstPaise,
            s.total.totalPaise,
            s.part.warranty_months,
            s.scannedCodeId,
            s.addedVia,
          ],
        );
        await db.query(
          `SELECT move_stock($1,'SALE',$2,0,0,'INVOICE',$3,$4,'Invoice sale',$5,NULL,$6)`,
          [
            s.part.id,
            -s.quantity,
            invoice.id,
            actor.id,
            input.customer_id || null,
            input.vehicle_id || null,
          ],
        );
      }
      for (const p of input.payments)
        await db.query(
          `INSERT INTO invoice_payments(invoice_id,mode,amount_paise,reference,recorded_by)
      VALUES($1,$2,$3,$4,$5)`,
          [invoice.id, p.mode, p.amount_paise, p.reference || null, actor.id],
        );
      if (customer && pending)
        await db.query('UPDATE customers SET outstanding_paise=outstanding_paise+$2 WHERE id=$1', [
          customer.id,
          pending,
        ]);
      if (input.vehicle_id)
        await db.query('UPDATE customer_vehicles SET last_visit_at=now() WHERE id=$1', [
          input.vehicle_id,
        ]);
      await audit(db, actor.id, 'CREATE', 'invoice', invoice.id, {
        number,
        totalPaise: totals.totalPaise,
        creditOverride: input.credit_override && pending > 0,
      });
      return invoice;
    });
    res.status(201).json(result);
  }),
);
billingRouter.get(
  '/sales/invoices/:id',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const invoice = await one(
      pool,
      `SELECT i.*,c.name customer_name,c.phone customer_phone,c.gstin customer_gstin,
    v.registration_number,v.chassis_number,v.vin,vc.model vehicle_model,u.name salesperson
    FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN customer_vehicles v ON v.id=i.vehicle_id
    LEFT JOIN vehicle_configurations vc ON vc.id=v.configuration_id LEFT JOIN users u ON u.id=i.created_by WHERE i.id=$1`,
      [req.params.id],
    );
    const [lines, payments, returns] = await Promise.all([
      pool.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY part_name', [
        invoice.id,
      ]),
      pool.query('SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY paid_at', [
        invoice.id,
      ]),
      pool.query('SELECT * FROM sales_returns WHERE invoice_id=$1 ORDER BY created_at DESC', [
        invoice.id,
      ]),
    ]);
    if (actor.role !== 'ADMIN') for (const line of lines.rows) delete line.cost_paise;
    res.json({ ...invoice, lines: lines.rows, payments: payments.rows, returns: returns.rows });
  }),
);
billingRouter.get(
  '/sales/invoices/:id/pdf',
  wrap(async (req, res) => {
    requireActor(req);
    const invoice = await one(
      pool,
      `SELECT i.*,c.name customer_name,c.phone customer_phone,c.gstin customer_gstin,
    v.registration_number,v.chassis_number,vc.model vehicle_model FROM invoices i
    LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN customer_vehicles v ON v.id=i.vehicle_id
    LEFT JOIN vehicle_configurations vc ON vc.id=v.configuration_id WHERE i.id=$1`,
      [req.params.id],
    );
    const lines = (
      await pool.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY part_name', [
        invoice.id,
      ])
    ).rows;
    const settings = await one(pool, 'SELECT * FROM business_settings WHERE id=1');
    const pdf = await renderInvoicePdf(invoice, lines, settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.invoice_number.replaceAll('/', '-')}.pdf"`,
    );
    res.send(pdf);
  }),
);
billingRouter.post(
  '/sales/invoices/:id/payments',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = z
        .object({
          mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER']),
          amount_paise: z.number().int().safe().positive(),
          reference: z.string().optional(),
        })
        .parse(req.body);
    await tx(async (db) => {
      const i = await one(db, 'SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (i.status !== 'COMPLETED') throw new HttpError(409, 'Invoice is not active.');
      if (input.amount_paise > Number(i.pending_paise))
        throw new HttpError(400, 'Payment exceeds pending amount.');
      await db.query(
        'INSERT INTO invoice_payments(invoice_id,mode,amount_paise,reference,recorded_by) VALUES($1,$2,$3,$4,$5)',
        [i.id, input.mode, input.amount_paise, input.reference || null, actor.id],
      );
      await db.query(
        'UPDATE invoices SET paid_paise=paid_paise+$2,pending_paise=pending_paise-$2 WHERE id=$1',
        [i.id, input.amount_paise],
      );
      if (i.customer_id)
        await db.query('UPDATE customers SET outstanding_paise=outstanding_paise-$2 WHERE id=$1', [
          i.customer_id,
          input.amount_paise,
        ]);
      await audit(db, actor.id, 'PAY', 'invoice', i.id, { amountPaise: input.amount_paise });
    });
    res.status(201).json({ ok: true });
  }),
);
billingRouter.post(
  '/sales/invoices/:id/returns',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = z
        .object({
          reason: z.string().min(5),
          lines: z
            .array(
              z.object({
                invoice_line_id: z.string().uuid(),
                quantity: z.number().int().safe().positive(),
                condition: z.enum(['GOOD', 'DAMAGED', 'DEFECTIVE', 'WARRANTY']),
              }),
            )
            .min(1),
        })
        .parse(req.body);
    if (new Set(input.lines.map((l) => l.invoice_line_id)).size !== input.lines.length)
      throw new HttpError(400, 'Combine duplicate return lines.');
    const result = await tx(async (db) => {
      const invoice = await one(db, 'SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      if (invoice.status !== 'COMPLETED') throw new HttpError(409, 'Invoice is not active.');
      const lineGross = Number(
        (
          await db.query(
            'SELECT coalesce(sum(total_paise),0) gross FROM invoice_lines WHERE invoice_id=$1',
            [invoice.id],
          )
        ).rows[0].gross,
      );
      const priorReturns = Number(
        (
          await db.query(
            'SELECT coalesce(sum(srl.amount_paise),0) amount FROM sales_return_lines srl JOIN sales_returns sr ON sr.id=srl.return_id WHERE sr.invoice_id=$1',
            [invoice.id],
          )
        ).rows[0].amount,
      );
      const entries = [] as { line: any; quantity: number; condition: string; amount: number }[];
      for (const item of input.lines) {
        const line = await one(
          db,
          'SELECT * FROM invoice_lines WHERE id=$1 AND invoice_id=$2 FOR UPDATE',
          [item.invoice_line_id, invoice.id],
        );
        if (Number(line.returned_quantity) + item.quantity > Number(line.quantity))
          throw new HttpError(409, 'Return quantity exceeds the original sale.');
        const grossPortion = (Number(line.total_paise) * item.quantity) / Number(line.quantity);
        const amount = lineGross
          ? Math.round((grossPortion * Number(invoice.total_paise)) / lineGross)
          : 0;
        entries.push({ line, quantity: item.quantity, condition: item.condition, amount });
      }
      let total = entries.reduce((n, e) => n + e.amount, 0);
      if (priorReturns + total > Number(invoice.total_paise)) {
        const excess = priorReturns + total - Number(invoice.total_paise);
        entries[entries.length - 1].amount -= excess;
        total -= excess;
      }
      const appliedToCredit = Math.min(total, Number(invoice.pending_paise));
      const refundDue = total - appliedToCredit;
      const row = (
        await db.query(
          `INSERT INTO sales_returns(invoice_id,reason,refund_paise,created_by) VALUES($1,$2,$3,$4) RETURNING *`,
          [invoice.id, input.reason, refundDue, actor.id],
        )
      ).rows[0];
      for (const e of entries) {
        await db.query(
          `INSERT INTO sales_return_lines(return_id,invoice_line_id,quantity,condition,amount_paise)
        VALUES($1,$2,$3,$4,$5)`,
          [row.id, e.line.id, e.quantity, e.condition, e.amount],
        );
        await db.query(
          'UPDATE invoice_lines SET returned_quantity=returned_quantity+$2 WHERE id=$1',
          [e.line.id, e.quantity],
        );
        const good = e.condition === 'GOOD';
        await db.query(
          `SELECT move_stock($1,'SALES_RETURN',$2,0,$3,'SALES_RETURN',$4,$5,$6,$7,NULL,$8)`,
          [
            e.line.part_id,
            good ? e.quantity : 0,
            good ? 0 : e.quantity,
            row.id,
            actor.id,
            input.reason,
            invoice.customer_id,
            invoice.vehicle_id,
          ],
        );
      }
      await db.query('UPDATE invoices SET pending_paise=pending_paise-$2 WHERE id=$1', [
        invoice.id,
        appliedToCredit,
      ]);
      if (invoice.customer_id && appliedToCredit)
        await db.query('UPDATE customers SET outstanding_paise=outstanding_paise-$2 WHERE id=$1', [
          invoice.customer_id,
          appliedToCredit,
        ]);
      await audit(db, actor.id, 'RETURN', 'invoice', invoice.id, {
        returnId: row.id,
        totalPaise: total,
      });
      return {
        ...row,
        total_paise: total,
        applied_to_credit_paise: appliedToCredit,
        refund_due_paise: refundDue,
      };
    });
    res.status(201).json(result);
  }),
);
billingRouter.post(
  '/sales/returns/:id/refunds',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER']),
          amount_paise: z.number().int().safe().positive(),
          reference: z.string().optional(),
        })
        .parse(req.body);
    const result = await tx(async (db) => {
      const saleReturn = await one(db, 'SELECT * FROM sales_returns WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      if (Number(saleReturn.refunded_paise) + input.amount_paise > Number(saleReturn.refund_paise))
        throw new HttpError(400, 'Refund exceeds the amount due.');
      const row = (
        await db.query(
          `INSERT INTO sales_return_refunds(return_id,amount_paise,mode,reference,recorded_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [saleReturn.id, input.amount_paise, input.mode, input.reference || null, actor.id],
        )
      ).rows[0];
      await db.query('UPDATE sales_returns SET refunded_paise=refunded_paise+$2 WHERE id=$1', [
        saleReturn.id,
        input.amount_paise,
      ]);
      await audit(db, actor.id, 'REFUND', 'sales_return', saleReturn.id, {
        amountPaise: input.amount_paise,
      });
      return row;
    });
    res.status(201).json(result);
  }),
);
billingRouter.post(
  '/sales/invoices/:id/cancel',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z.object({ reason: z.string().min(5) }).parse(req.body);
    await tx(async (db) => {
      const invoice = await one(db, 'SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      if (invoice.status !== 'COMPLETED') throw new HttpError(409, 'Invoice is not active.');
      if (Number(invoice.paid_paise) > 0)
        throw new HttpError(409, 'Paid invoices require a return and refund workflow.');
      const returned = await db.query('SELECT 1 FROM sales_returns WHERE invoice_id=$1 LIMIT 1', [
        invoice.id,
      ]);
      if (returned.rows.length)
        throw new HttpError(409, 'An invoice with returns cannot be cancelled.');
      const lines = (
        await db.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY part_id', [
          invoice.id,
        ])
      ).rows;
      for (const l of lines)
        await db.query(
          `SELECT move_stock($1,'INVOICE_CANCELLATION',$2,0,0,'INVOICE',$3,$4,$5,$6,NULL,$7)`,
          [
            l.part_id,
            l.quantity,
            invoice.id,
            actor.id,
            input.reason,
            invoice.customer_id,
            invoice.vehicle_id,
          ],
        );
      await db.query(
        'UPDATE invoices SET status=$2,cancellation_reason=$3,cancelled_at=now(),pending_paise=0 WHERE id=$1',
        [invoice.id, 'CANCELLED', input.reason],
      );
      if (invoice.customer_id)
        await db.query('UPDATE customers SET outstanding_paise=outstanding_paise-$2 WHERE id=$1', [
          invoice.customer_id,
          invoice.pending_paise,
        ]);
      await audit(db, actor.id, 'CANCEL', 'invoice', invoice.id, { reason: input.reason });
    });
    res.json({ ok: true });
  }),
);
