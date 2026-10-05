import { Router } from 'express';
import { z } from 'zod';
import bwipjs from 'bwip-js';
import { pool, tx, one, audit, HttpError } from './db.js';
import { wrap, requireAdmin, requireActor } from './http.js';
import {
  codeInput,
  codeValue,
  scanSource,
  scanContext,
  scannerSettings,
  barcodeOptions,
  validateCodeFormat,
} from './product-code-domain.js';
import { assignCode, codeConflict, conflictMessage, syncPrimary } from './product-code-service.js';
import { renderLabels } from './product-labels.js';

export const productCodeRouter = Router();
productCodeRouter.get(
  '/scanner/settings',
  wrap(async (_req, res) => {
    res.json(
      (await one(pool, 'SELECT scanner_settings FROM business_settings WHERE id=1'))
        .scanner_settings,
    );
  }),
);
productCodeRouter.patch(
  '/scanner/settings',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = scannerSettings.parse(req.body);
    await tx(async (db) => {
      const old = await one(
        db,
        'SELECT scanner_settings FROM business_settings WHERE id=1 FOR UPDATE',
      );
      await db.query('UPDATE business_settings SET scanner_settings=$1 WHERE id=1', [input]);
      await audit(db, actor.id, 'UPDATE', 'scanner_settings', '1', {
        old: old.scanner_settings,
        new: input,
      });
    });
    res.json(input);
  }),
);
productCodeRouter.post(
  '/product-codes/validate',
  wrap(async (req, res) => {
    requireAdmin(req);
    const input = codeInput.parse(req.body);
    try {
      validateCodeFormat(input.code, input.format);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const existing = await codeConflict(pool, input.code);
    const conflicts = (
      await pool.query(
        `SELECT c.id,p.id part_id,p.name,p.oem_number,p.sku,c.reason
    FROM product_code_migration_conflicts c JOIN parts p ON p.id=ANY(c.part_ids)
    WHERE c.normalized_code=$1 AND c.resolved_at IS NULL`,
        [input.code],
      )
    ).rows;
    res.json({
      available: !existing && !conflicts.length,
      code: input.code,
      conflict: existing
        ? {
            part_id: existing.part_id,
            name: existing.part_name,
            oem_number: existing.oem_number,
            is_active: existing.is_active,
          }
        : null,
      message: existing
        ? conflictMessage(existing)
        : conflicts.length
          ? 'Legacy records conflict. Confirm the intended product to resolve this code.'
          : 'Available',
      legacy_conflicts: conflicts,
    });
  }),
);
productCodeRouter.get(
  '/product-codes/conflicts',
  wrap(async (req, res) => {
    requireAdmin(req);
    res.json(
      (
        await pool.query(`SELECT c.*,jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'oem_number',p.oem_number)) products
    FROM product_code_migration_conflicts c JOIN parts p ON p.id=ANY(c.part_ids) WHERE c.resolved_at IS NULL GROUP BY c.id ORDER BY c.id`)
      ).rows,
    );
  }),
);
productCodeRouter.post(
  '/product-codes/resolve',
  wrap(async (req, res) => {
    const actor = requireActor(req),
      input = z
        .object({
          code: codeValue,
          scan_id: z.string().uuid(),
          source: scanSource,
          context: scanContext,
          vehicle_id: z.string().uuid().optional().nullable(),
        })
        .parse(req.body);
    const result = await tx(async (db) => {
      const row = (
        await db.query(
          `SELECT pc.id code_id,pc.code,pc.code_type,pc.format,pc.is_active code_active,
      p.id,p.name,p.oem_number,p.sku,p.short_name,p.unit,p.hsn,p.selling_price_paise,p.mrp_paise,p.tax_mode,p.gst_bps,
      p.current_stock,p.reserved_stock,p.current_stock-p.reserved_stock available_stock,p.damaged_stock,
      p.min_stock,p.reorder_level,p.rack,p.shelf,p.bin,p.active,p.warranty_months,
      CASE WHEN v.configuration_id IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM part_compatibility fit WHERE fit.part_id=p.id AND fit.configuration_id=v.configuration_id) END compatible,
      v.registration_number
      FROM product_codes pc JOIN parts p ON p.id=pc.part_id
      LEFT JOIN customer_vehicles v ON v.id=$2 WHERE pc.normalized_code=$1`,
          [input.code, input.vehicle_id || null],
        )
      ).rows[0];
      let status = !row
        ? 'NOT_FOUND'
        : !row.code_active
          ? 'DISABLED_CODE'
          : !row.active
            ? 'INACTIVE_PRODUCT'
            : Number(row.available_stock) < 1
              ? 'OUT_OF_STOCK'
              : 'FOUND';
      if (
        !row &&
        (
          await db.query(
            'SELECT 1 FROM product_code_migration_conflicts WHERE normalized_code=$1 AND resolved_at IS NULL',
            [input.code],
          )
        ).rows.length
      )
        status = 'LEGACY_CONFLICT';
      await db.query(
        `INSERT INTO scan_events(id,user_id,code_id,part_id,scan_source,context,result) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
        [
          input.scan_id,
          actor.id,
          row?.code_id || null,
          row?.id || null,
          input.source,
          input.context,
          status,
        ],
      );
      if (!row) return { found: false, status, code: input.code, product: null };
      const { code_id, code, code_type, format, code_active, ...product } = row;
      return {
        found: true,
        status,
        code: { id: code_id, value: code, type: code_type, format, is_active: code_active },
        product,
      };
    });
    res.json(result);
  }),
);
productCodeRouter.get(
  '/parts/:id/codes',
  wrap(async (req, res) => {
    await one(pool, 'SELECT id FROM parts WHERE id=$1', [req.params.id]);
    res.json(
      (
        await pool.query(
          'SELECT * FROM product_codes WHERE part_id=$1 ORDER BY is_primary DESC,is_active DESC,created_at',
          [req.params.id],
        )
      ).rows,
    );
  }),
);
productCodeRouter.post(
  '/product-codes',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = codeInput.extend({ part_id: z.string().uuid() }).parse(req.body);
    res.status(201).json(await tx((db) => assignCode(db, input.part_id, input, actor.id)));
  }),
);
productCodeRouter.post(
  '/product-codes/generate',
  wrap(async (req, res) => {
    const actor = requireAdmin(req),
      input = z
        .object({ kind: z.enum(['BARCODE', 'QR']), part_id: z.string().uuid().optional() })
        .parse(req.body);
    const code = await tx(async (db) => {
      let value: string;
      do {
        const row = await one(db, "SELECT nextval('product_code_number') n");
        value =
          input.kind === 'QR'
            ? `SAM:P:${BigInt(row.n).toString(36).toUpperCase().padStart(8, '0')}`
            : `SAM${String(row.n).padStart(10, '0')}`;
      } while (await codeConflict(db, value));
      const draft = codeInput.parse({
        code: value,
        code_type: input.kind === 'QR' ? 'QR_CODE' : 'INTERNAL_BARCODE',
        format: input.kind === 'QR' ? 'QR_CODE' : 'CODE_128',
        source: 'SHANTI_AUTO_MOBILES',
      });
      return input.part_id ? assignCode(db, input.part_id, draft, actor.id) : draft;
    });
    res.status(201).json(code);
  }),
);
for (const action of ['primary', 'disable', 'enable'] as const) {
  productCodeRouter.patch(
    `/product-codes/:id/${action}`,
    wrap(async (req, res) => {
      const actor = requireAdmin(req);
      const result = await tx(async (db) => {
        const initial = await one(db, 'SELECT part_id FROM product_codes WHERE id=$1', [
          req.params.id,
        ]);
        const part = await one(db, 'SELECT active FROM parts WHERE id=$1 FOR UPDATE', [
          initial.part_id,
        ]);
        const old = await one(db, 'SELECT * FROM product_codes WHERE id=$1 FOR UPDATE', [
          req.params.id,
        ]);
        if (action !== 'disable' && !part.active)
          throw new HttpError(409, 'Restore this product first.');
        if (action === 'primary' && !old.is_active)
          throw new HttpError(409, 'Enable this code before making it primary.');
        if (action === 'primary')
          await db.query(
            'UPDATE product_codes SET is_primary=false,updated_at=now() WHERE part_id=$1 AND is_primary',
            [old.part_id],
          );
        await db.query(
          `UPDATE product_codes SET is_active=$2,is_primary=$3,updated_at=now() WHERE id=$1`,
          [
            old.id,
            action !== 'disable',
            action === 'primary' || (action === 'enable' && old.is_primary),
          ],
        );
        await syncPrimary(db, old.part_id);
        const updated = await one(db, 'SELECT * FROM product_codes WHERE id=$1', [old.id]);
        await audit(
          db,
          actor.id,
          action === 'primary'
            ? 'PRIMARY_CODE_CHANGED'
            : action === 'disable'
              ? 'BARCODE_DISABLED'
              : 'BARCODE_ENABLED',
          'product_code',
          old.id,
          { part_id: old.part_id, old, new: updated },
        );
        return updated;
      });
      res.json(result);
    }),
  );
}
productCodeRouter.get(
  '/product-codes/:id/image',
  wrap(async (req, res) => {
    const code = await one(pool, 'SELECT code,format FROM product_codes WHERE id=$1', [
      req.params.id,
    ]);
    res.type('image/svg+xml').send(bwipjs.toSVG(barcodeOptions(code.code, code.format)));
  }),
);
productCodeRouter.post(
  '/product-codes/labels',
  wrap(async (req, res) => {
    const actor = requireAdmin(req);
    const input = z
      .object({
        items: z
          .array(
            z.object({
              part_id: z.string().uuid(),
              code_id: z.string().uuid().optional(),
              quantity: z.number().int().min(1).max(200),
            }),
          )
          .min(1)
          .max(100),
        template: z.enum(['SMALL', 'MINIMAL']).default('SMALL'),
        layout: z.enum(['SHEET', 'ROLL']).default('SHEET'),
        show_price: z.boolean().default(false),
        show_oem: z.boolean().default(true),
        show_sku: z.boolean().default(true),
      })
      .parse(req.body);
    if (input.items.reduce((n, item) => n + item.quantity, 0) > 500)
      throw new HttpError(400, 'Print at most 500 labels at once.');
    const rows = [];
    for (const item of input.items) {
      const row = (
        await pool.query(
          `SELECT pc.*,p.name,p.oem_number,p.sku,p.selling_price_paise FROM product_codes pc JOIN parts p ON p.id=pc.part_id
      WHERE pc.part_id=$1 AND pc.is_active AND ($2::uuid IS NULL AND pc.is_primary OR pc.id=$2)`,
          [item.part_id, item.code_id || null],
        )
      ).rows[0];
      if (!row)
        throw new HttpError(
          409,
          'Every selected product needs an active code. Open Codes & Labels to assign one.',
        );
      rows.push({ ...row, quantity: item.quantity });
    }
    const business = await one(pool, 'SELECT name FROM business_settings WHERE id=1');
    const pdf = await renderLabels(rows, input, business.name);
    await audit(pool, actor.id, 'LABELS_PRINTED', 'product_codes', 'batch', {
      items: input.items,
      template: input.template,
    });
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', 'inline; filename="sam-product-labels.pdf"');
    res.send(pdf);
  }),
);
productCodeRouter.get(
  '/parts/:id/warranty-invoices',
  wrap(async (req, res) => {
    res.json(
      (
        await pool.query(
          `SELECT il.id invoice_line_id,i.id invoice_id,i.invoice_number,i.created_at,il.part_name,il.quantity,il.warranty_months,c.name customer_name,v.registration_number
    FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN customer_vehicles v ON v.id=i.vehicle_id
    WHERE il.part_id=$1 AND i.status='COMPLETED' AND il.warranty_months>0 ORDER BY i.created_at DESC LIMIT 100`,
          [req.params.id],
        )
      ).rows,
    );
  }),
);
