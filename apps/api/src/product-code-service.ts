import { type DB, HttpError, one, audit } from './db.js';
import { codeInput, type CodeInput, validateCodeFormat } from './product-code-domain.js';

export async function codeConflict(db: DB, code: string) {
  return (
    await db.query(
      `SELECT pc.*,p.name part_name,p.oem_number,p.sku FROM product_codes pc
    JOIN parts p ON p.id=pc.part_id WHERE pc.normalized_code=$1`,
      [code],
    )
  ).rows[0];
}
export function conflictMessage(row: any) {
  return `This barcode is already assigned to ${row.part_name} — OEM ${row.oem_number || row.sku}${row.is_active ? '.' : ' (disabled; code history is retained).'}`;
}
export async function syncPrimary(db: DB, partId: string) {
  const active = (
    await db.query(
      'SELECT id,code FROM product_codes WHERE part_id=$1 AND is_active ORDER BY is_primary DESC,created_at,id',
      [partId],
    )
  ).rows;
  if (active[0])
    await db.query('UPDATE product_codes SET is_primary=true WHERE id=$1', [active[0].id]);
  await db.query('UPDATE parts SET barcode=$2 WHERE id=$1', [partId, active[0]?.code || null]);
}
export async function assignCode(db: DB, partId: string, raw: unknown, actorId: string) {
  const input: CodeInput = codeInput.parse(raw);
  try {
    validateCodeFormat(input.code, input.format);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const part = await one(db, 'SELECT id,active FROM parts WHERE id=$1 FOR UPDATE', [partId]);
  if (!part.active) throw new HttpError(409, 'Restore this product before assigning codes.');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,741))', [input.code]);
  const existing = await codeConflict(db, input.code);
  if (existing) throw new HttpError(409, conflictMessage(existing));
  const legacy = (
    await db.query(
      'SELECT * FROM product_code_migration_conflicts WHERE normalized_code=$1 AND resolved_at IS NULL',
      [input.code],
    )
  ).rows;
  if (legacy.length && !input.resolve_conflict)
    throw new HttpError(
      409,
      'This code has conflicting legacy records. An administrator must explicitly resolve the conflict.',
    );
  if (input.is_primary)
    await db.query(
      'UPDATE product_codes SET is_primary=false,updated_at=now() WHERE part_id=$1 AND is_primary',
      [partId],
    );
  const row = (
    await db.query(
      `INSERT INTO product_codes(part_id,code,normalized_code,code_type,format,source,is_primary,created_by,notes)
    VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        partId,
        input.code,
        input.code_type,
        input.format,
        input.source,
        input.is_primary,
        actorId,
        input.notes || null,
      ],
    )
  ).rows[0];
  if (legacy.length) {
    // Free conflicting legacy mirrors only after an explicit, audited resolution.
    await db.query(
      "UPDATE parts SET barcode=NULL WHERE id<>$1 AND btrim(barcode,E' \\t\\n\\r\\f\\v')=$2",
      [partId, input.code],
    );
    await db.query(
      'UPDATE product_code_migration_conflicts SET resolved_at=now(),resolved_by=$2 WHERE normalized_code=$1 AND resolved_at IS NULL',
      [input.code, actorId],
    );
  }
  await syncPrimary(db, partId);
  await audit(
    db,
    actorId,
    input.source === 'SHANTI_AUTO_MOBILES'
      ? input.code_type === 'QR_CODE'
        ? 'QR_GENERATED'
        : 'BARCODE_GENERATED'
      : 'BARCODE_ASSIGNED',
    'product_code',
    row.id,
    { part_id: partId, old: null, new: row, legacy_conflicts: legacy },
  );
  return one(db, 'SELECT * FROM product_codes WHERE id=$1', [row.id]);
}
export async function changeLegacyBarcode(
  db: DB,
  partId: string,
  code: string | null,
  actorId: string,
) {
  const current = (
    await db.query('SELECT * FROM product_codes WHERE part_id=$1 AND is_primary', [partId])
  ).rows[0];
  const normalized = code?.trim() || null;
  if (current?.code === normalized) return;
  if (current) {
    await db.query(
      'UPDATE product_codes SET is_active=false,is_primary=false,updated_at=now() WHERE id=$1',
      [current.id],
    );
    await audit(db, actorId, 'BARCODE_DISABLED', 'product_code', current.id, {
      part_id: partId,
      old: current,
      new: { is_active: false },
      source: 'legacy_field_update',
    });
  }
  if (normalized) await assignCode(db, partId, { code: normalized, is_primary: true }, actorId);
  else await syncPrimary(db, partId);
}
