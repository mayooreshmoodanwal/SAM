import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, tx, one, audit, HttpError } from './db.js';
import { wrap, requireAdmin } from './http.js';

export const purchaseRouter = Router();
const purchaseInput = z.object({
  supplier_id: z.string().uuid(),
  supplier_invoice_number: z.string().optional(),
  invoice_date: z.string().optional(),
  expected_date: z.string().optional(),
  payment_due_date: z.string().optional(),
  status: z.enum(['DRAFT', 'ORDERED']).default('ORDERED'),
  freight_paise: z.number().int().safe().min(0).default(0),
  other_charges_paise: z.number().int().safe().min(0).default(0),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        part_id: z.string().uuid(),
        quantity_ordered: z.number().int().safe().positive(),
        rate_paise: z.number().int().safe().min(0),
        discount_paise: z.number().int().safe().min(0).default(0),
        gst_bps: z.number().int().safe().min(0).max(10000).default(1800),
        freight_paise: z.number().int().safe().min(0).default(0),
        other_charges_paise: z.number().int().safe().min(0).default(0),
        batch_number: z.string().optional(),
        lot_number: z.string().optional(),
        warehouse: z.string().optional(),
        rack: z.string().optional(),
      }),
    )
    .min(1),
});
purchaseRouter.get(
  '/purchases',
  wrap(async (req, res) => {
    requireAdmin(req);
    const q = String(req.query.q || '');
    res.json(
      (
        await pool.query(
          `SELECT p.*,s.name supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
    WHERE $1='' OR p.purchase_number ILIKE '%'||$1||'%' OR s.name ILIKE '%'||$1||'%'
    ORDER BY p.created_at DESC LIMIT 100`,
          [q],
        )
      ).rows,
    );
  }),
);
purchaseRouter.post(
  '/purchases',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = purchaseInput.parse(req.body);
    if (new Set(input.lines.map((l) => l.part_id)).size !== input.lines.length)
      throw new HttpError(400, 'Combine duplicate parts into one purchase line.');
    const result = await tx(async (db) => {
      const supplier = await one(db, 'SELECT id,status FROM suppliers WHERE id=$1 FOR UPDATE', [
        input.supplier_id,
      ]);
      if (supplier.status !== 'ACTIVE') throw new HttpError(409, 'Supplier is not active.');
      const number = `PO-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const total = input.lines.reduce((n, l) => {
        const taxable = l.quantity_ordered * l.rate_paise - l.discount_paise;
        if (taxable < 0) throw new HttpError(400, 'Discount exceeds purchase line value.');
        return (
          n +
          taxable +
          Math.round((taxable * l.gst_bps) / 10000) +
          l.freight_paise +
          l.other_charges_paise
        );
      }, input.freight_paise + input.other_charges_paise);
      const purchase = (
        await db.query(
          `INSERT INTO purchases(purchase_number,supplier_id,supplier_invoice_number,invoice_date,
      expected_date,payment_due_date,status,total_paise,freight_paise,other_charges_paise,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            number,
            input.supplier_id,
            input.supplier_invoice_number || null,
            input.invoice_date || null,
            input.expected_date || null,
            input.payment_due_date || null,
            input.status,
            total,
            input.freight_paise,
            input.other_charges_paise,
            input.notes || null,
            actor.id,
          ],
        )
      ).rows[0];
      for (const line of input.lines)
        await db.query(
          `INSERT INTO purchase_lines(purchase_id,part_id,quantity_ordered,rate_paise,
      discount_paise,gst_bps,freight_paise,other_charges_paise,batch_number,lot_number,warehouse,rack)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            purchase.id,
            line.part_id,
            line.quantity_ordered,
            line.rate_paise,
            line.discount_paise,
            line.gst_bps,
            line.freight_paise,
            line.other_charges_paise,
            line.batch_number || null,
            line.lot_number || null,
            line.warehouse || null,
            line.rack || null,
          ],
        );
      await audit(db, actor.id, 'CREATE', 'purchase', purchase.id, { number });
      return purchase;
    });
    res.status(201).json(result);
  }),
);
purchaseRouter.get(
  '/purchases/:id',
  wrap(async (req, res) => {
    requireAdmin(req);
    const purchase = await one(
      pool,
      `SELECT p.*,s.name supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1`,
      [req.params.id],
    );
    const [lines, receipts, payments] = await Promise.all([
      pool.query(
        'SELECT pl.*,pt.name part_name,pt.sku FROM purchase_lines pl JOIN parts pt ON pt.id=pl.part_id WHERE purchase_id=$1',
        [purchase.id],
      ),
      pool.query(
        'SELECT pr.* FROM purchase_receipts pr JOIN purchase_lines pl ON pl.id=pr.purchase_line_id WHERE pl.purchase_id=$1 ORDER BY pr.received_at DESC',
        [purchase.id],
      ),
      pool.query('SELECT * FROM purchase_payments WHERE purchase_id=$1 ORDER BY paid_at DESC', [
        purchase.id,
      ]),
    ]);
    res.json({ ...purchase, lines: lines.rows, receipts: receipts.rows, payments: payments.rows });
  }),
);
purchaseRouter.post(
  '/purchases/:id/receive',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          lines: z
            .array(
              z.object({
                line_id: z.string().uuid(),
                quantity: z.number().int().safe().positive(),
                free_quantity: z.number().int().safe().min(0).default(0),
              }),
            )
            .min(1),
        })
        .parse(req.body);
    if (new Set(input.lines.map((l) => l.line_id)).size !== input.lines.length)
      throw new HttpError(400, 'Duplicate receipt line.');
    const result = await tx(async (db) => {
      const purchase = await one(db, 'SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(purchase.status))
        throw new HttpError(409, 'Purchase is not ready to receive.');
      const allLines = (
        await db.query(
          'SELECT id,part_id,quantity_ordered FROM purchase_lines WHERE purchase_id=$1',
          [purchase.id],
        )
      ).rows;
      const partIds = new Map(allLines.map((l) => [l.id, l.part_id]));
      const orderedQty = allLines.reduce((n, l) => n + Number(l.quantity_ordered), 0);
      let receivedValue = 0,
        receivedQty = 0;
      const receiptIds: string[] = [];
      for (const item of [...input.lines].sort((a, b) =>
        String(partIds.get(a.line_id)).localeCompare(String(partIds.get(b.line_id))),
      )) {
        const line = await one(
          db,
          'SELECT * FROM purchase_lines WHERE id=$1 AND purchase_id=$2 FOR UPDATE',
          [item.line_id, purchase.id],
        );
        if (Number(line.quantity_received) + item.quantity > Number(line.quantity_ordered))
          throw new HttpError(409, 'Received quantity exceeds ordered quantity.');
        const lineDiscount = Math.round(
          (Number(line.discount_paise) * item.quantity) / Number(line.quantity_ordered),
        );
        const taxable = item.quantity * Number(line.rate_paise) - lineDiscount;
        const gst = Math.round((taxable * Number(line.gst_bps)) / 10000);
        const freight = Math.round(
          ((Number(line.freight_paise) + Number(line.other_charges_paise)) * item.quantity) /
            Number(line.quantity_ordered),
        );
        const headerCost = Math.round(
          ((Number(purchase.freight_paise) + Number(purchase.other_charges_paise)) *
            item.quantity) /
            orderedQty,
        );
        const receiptValue = taxable + gst + freight + headerCost;
        receivedValue += taxable + gst + freight;
        receivedQty += item.quantity;
        const landedUnit = Math.round(
          (taxable + freight + headerCost) / (item.quantity + item.free_quantity),
        );
        await db.query(
          `UPDATE purchase_lines SET quantity_received=quantity_received+$2,free_quantity=free_quantity+$3,
        landed_unit_cost_paise=$4 WHERE id=$1`,
          [line.id, item.quantity, item.free_quantity, landedUnit],
        );
        const receipt = (
          await db.query(
            `INSERT INTO purchase_receipts(purchase_line_id,quantity,free_quantity,received_by,value_paise)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,
            [line.id, item.quantity, item.free_quantity, actor.id, receiptValue],
          )
        ).rows[0];
        receiptIds.push(receipt.id);
        await db.query(
          `SELECT move_stock($1,'PURCHASE_RECEIVED',$2,0,0,'PURCHASE',$3,$4,'Goods received',NULL,$5)`,
          [
            line.part_id,
            item.quantity + item.free_quantity,
            purchase.id,
            actor.id,
            purchase.supplier_id,
          ],
        );
        const oldPrice = await one(
          db,
          'SELECT purchase_price_paise,selling_price_paise,mrp_paise FROM parts WHERE id=$1',
          [line.part_id],
        );
        await db.query('UPDATE parts SET purchase_price_paise=$2 WHERE id=$1', [
          line.part_id,
          landedUnit,
        ]);
        if (Number(oldPrice.purchase_price_paise) !== landedUnit)
          await db.query(
            `INSERT INTO part_price_history(part_id,old_purchase_paise,new_purchase_paise,
          old_selling_paise,new_selling_paise,old_mrp_paise,new_mrp_paise,source,changed_by)
          VALUES($1,$2,$3,$4,$4,$5,$5,'PURCHASE_RECEIPT',$6)`,
            [
              line.part_id,
              oldPrice.purchase_price_paise,
              landedUnit,
              oldPrice.selling_price_paise,
              oldPrice.mrp_paise,
              actor.id,
            ],
          );
      }
      const all = (
        await db.query(
          `SELECT bool_and(quantity_received=quantity_ordered) complete FROM purchase_lines WHERE purchase_id=$1`,
          [purchase.id],
        )
      ).rows[0].complete;
      const status = all ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      const headerShare = Math.round(
        ((Number(purchase.freight_paise) + Number(purchase.other_charges_paise)) * receivedQty) /
          orderedQty,
      );
      receivedValue += headerShare;
      if (all) receivedValue = Number(purchase.total_paise) - Number(purchase.received_value_paise);
      const enteredValue = Number(
        (
          await db.query(
            'SELECT coalesce(sum(value_paise),0) amount FROM purchase_receipts WHERE id=ANY($1)',
            [receiptIds],
          )
        ).rows[0].amount,
      );
      const roundingDifference = receivedValue - enteredValue;
      if (roundingDifference)
        await db.query('UPDATE purchase_receipts SET value_paise=value_paise+$2 WHERE id=$1', [
          receiptIds[receiptIds.length - 1],
          roundingDifference,
        ]);
      await db.query(
        `UPDATE purchases SET status=$2,received_by=$3,received_at=now(),
      received_value_paise=received_value_paise+$4,
      payment_status=CASE WHEN paid_paise>=received_value_paise+$4 THEN 'PAID'
        WHEN paid_paise>0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END WHERE id=$1`,
        [purchase.id, status, actor.id, receivedValue],
      );
      await db.query('UPDATE suppliers SET outstanding_paise=outstanding_paise+$2 WHERE id=$1', [
        purchase.supplier_id,
        receivedValue,
      ]);
      await audit(db, actor.id, 'RECEIVE', 'purchase', purchase.id, {
        lines: input.lines,
        receivedValue,
      });
      return { status, receivedValuePaise: receivedValue };
    });
    res.json(result);
  }),
);
purchaseRouter.post(
  '/purchases/:id/payments',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          amount_paise: z.number().int().safe().positive(),
          mode: z.string().min(2),
          reference: z.string().optional(),
        })
        .parse(req.body);
    await tx(async (db) => {
      const p = await one(db, 'SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [req.params.id]);
      const returnedCredit = Number(
        (
          await db.query(
            'SELECT coalesce(sum(credit_paise),0) credit FROM purchase_returns WHERE purchase_id=$1',
            [p.id],
          )
        ).rows[0].credit,
      );
      const netDue = Number(p.received_value_paise) - returnedCredit;
      if (Number(p.paid_paise) + input.amount_paise > netDue)
        throw new HttpError(400, 'Payment exceeds received goods after returns.');
      const supplier = await one(
        db,
        'SELECT outstanding_paise FROM suppliers WHERE id=$1 FOR UPDATE',
        [p.supplier_id],
      );
      if (input.amount_paise > Number(supplier.outstanding_paise))
        throw new HttpError(400, 'Payment exceeds supplier payable.');
      await db.query(
        'INSERT INTO purchase_payments(purchase_id,amount_paise,mode,reference,recorded_by) VALUES($1,$2,$3,$4,$5)',
        [p.id, input.amount_paise, input.mode, input.reference || null, actor.id],
      );
      const paid = Number(p.paid_paise) + input.amount_paise;
      await db.query('UPDATE purchases SET paid_paise=$2,payment_status=$3 WHERE id=$1', [
        p.id,
        paid,
        paid >= netDue ? 'PAID' : 'PARTIALLY_PAID',
      ]);
      await db.query('UPDATE suppliers SET outstanding_paise=outstanding_paise-$2 WHERE id=$1', [
        p.supplier_id,
        input.amount_paise,
      ]);
      await audit(db, actor.id, 'PAY', 'purchase', p.id, { amountPaise: input.amount_paise });
    });
    res.status(201).json({ ok: true });
  }),
);
purchaseRouter.post(
  '/purchases/:id/returns',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({
          part_id: z.string().uuid(),
          quantity: z.number().int().safe().positive(),
          reason: z.string().min(5),
          credit_note: z.string().optional(),
          refund_paise: z.number().int().safe().min(0).default(0),
        })
        .parse(req.body);
    const result = await tx(async (db) => {
      const purchase = await one(db, 'SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ]);
      const line = await one(
        db,
        'SELECT * FROM purchase_lines WHERE purchase_id=$1 AND part_id=$2 FOR UPDATE',
        [purchase.id, input.part_id],
      );
      const previous = (
        await db.query(
          'SELECT coalesce(sum(quantity),0) quantity FROM purchase_returns WHERE purchase_id=$1 AND part_id=$2',
          [purchase.id, input.part_id],
        )
      ).rows[0];
      if (
        Number(previous.quantity) + input.quantity >
        Number(line.quantity_received) + Number(line.free_quantity)
      )
        throw new HttpError(409, 'Return exceeds received quantity.');
      const discount = Math.round(
        (Number(line.discount_paise) * input.quantity) / Number(line.quantity_ordered),
      );
      const taxable = input.quantity * Number(line.rate_paise) - discount;
      const credit =
        taxable +
        Math.round((taxable * Number(line.gst_bps)) / 10000) +
        Math.round(
          ((Number(line.freight_paise) + Number(line.other_charges_paise)) * input.quantity) /
            Number(line.quantity_ordered),
        );
      const supplier = await one(
        db,
        'SELECT outstanding_paise,credit_balance_paise FROM suppliers WHERE id=$1 FOR UPDATE',
        [purchase.supplier_id],
      );
      const offset = Math.min(credit, Number(supplier.outstanding_paise));
      const creditBalance = Number(supplier.credit_balance_paise) + credit - offset;
      if (input.refund_paise > creditBalance)
        throw new HttpError(400, 'Cash refund exceeds supplier credit balance.');
      const row = (
        await db.query(
          `INSERT INTO purchase_returns(purchase_id,part_id,quantity,reason,credit_note,refund_paise,credit_paise,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            purchase.id,
            input.part_id,
            input.quantity,
            input.reason,
            input.credit_note || null,
            input.refund_paise,
            credit,
            actor.id,
          ],
        )
      ).rows[0];
      await db.query(
        `SELECT move_stock($1,'PURCHASE_RETURN',$2,0,0,'PURCHASE_RETURN',$3,$4,$5,NULL,$6)`,
        [input.part_id, -input.quantity, row.id, actor.id, input.reason, purchase.supplier_id],
      );
      await db.query(
        'UPDATE suppliers SET outstanding_paise=outstanding_paise-$2,credit_balance_paise=$3 WHERE id=$1',
        [purchase.supplier_id, offset, creditBalance - input.refund_paise],
      );
      const returnedUnits = Number(
        (
          await db.query(
            'SELECT coalesce(sum(quantity),0) quantity FROM purchase_returns WHERE purchase_id=$1',
            [purchase.id],
          )
        ).rows[0].quantity,
      );
      const receivedUnits = Number(
        (
          await db.query(
            'SELECT coalesce(sum(quantity_received+free_quantity),0) quantity FROM purchase_lines WHERE purchase_id=$1',
            [purchase.id],
          )
        ).rows[0].quantity,
      );
      const totalCredits = Number(
        (
          await db.query(
            'SELECT coalesce(sum(credit_paise),0) credit FROM purchase_returns WHERE purchase_id=$1',
            [purchase.id],
          )
        ).rows[0].credit,
      );
      const netDueAfterReturn = Number(purchase.received_value_paise) - totalCredits;
      const paymentStatus =
        Number(purchase.paid_paise) >= netDueAfterReturn
          ? 'PAID'
          : Number(purchase.paid_paise) > 0
            ? 'PARTIALLY_PAID'
            : 'UNPAID';
      await db.query('UPDATE purchases SET status=$2,payment_status=$3 WHERE id=$1', [
        purchase.id,
        purchase.status === 'RECEIVED' && returnedUnits >= receivedUnits
          ? 'RETURNED'
          : purchase.status,
        paymentStatus,
      ]);
      await audit(db, actor.id, 'RETURN', 'purchase', purchase.id, { returnId: row.id });
      return row;
    });
    res.status(201).json(result);
  }),
);
