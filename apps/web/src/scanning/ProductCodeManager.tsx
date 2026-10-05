import React, { useEffect, useState } from 'react';
import { api, post, patch, dateTime } from '../api';
import { Panel, Modal, Field, Message, Table, useData } from '../ui';
import { ScanControl } from './ScanControl';

export type CodeDraft = {
  code: string;
  code_type: string;
  format: string;
  source: string;
  is_primary: boolean;
  resolve_conflict?: boolean;
  notes?: string;
};
const types = [
  'MANUFACTURER_BARCODE',
  'INTERNAL_BARCODE',
  'OEM_BARCODE',
  'QR_CODE',
  'SUPPLIER_BARCODE',
  'PACKAGING_BARCODE',
  'ALTERNATE_BARCODE',
];
const formats = [
  'UNKNOWN',
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'ITF',
  'CODABAR',
  'QR_CODE',
  'DATA_MATRIX',
];
const blank: CodeDraft = {
  code: '',
  code_type: 'MANUFACTURER_BARCODE',
  format: 'UNKNOWN',
  source: 'ADMIN_MANUAL',
  is_primary: false,
};
export function CodeEntry({
  onAdd,
  existing = [],
  initialCode = '',
}: {
  onAdd: (code: CodeDraft) => Promise<void> | void;
  existing?: CodeDraft[];
  initialCode?: string;
}) {
  const [draft, setDraft] = useState<CodeDraft>({ ...blank, code: initialCode }),
    [validation, setValidation] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function validate(next: CodeDraft) {
    setError('');
    if (existing.some((c) => c.code === next.code.trim()))
      throw new Error('This code is already in the new product.');
    const result = await post('/product-codes/validate', next);
    setValidation(result);
    return result;
  }
  const change = (values: Partial<CodeDraft>) => {
    setDraft({ ...draft, ...values });
    setValidation(null);
    setError('');
  };
  async function add() {
    setBusy(true);
    try {
      const result = await validate(draft);
      if (!result.available && !(result.legacy_conflicts?.length && draft.resolve_conflict))
        throw new Error(result.message);
      await onAdd({ ...draft, code: result.code });
      setDraft(blank);
      setValidation(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="code-entry">
      <h3>Barcode / QR identification</h3>
      <p className="muted">
        Scan an existing label, enter its value, or generate an internal identifier.
      </p>
      <ScanControl
        context="PRODUCT_BARCODE_CAPTURE"
        manual={false}
        onCapture={async (scan) => {
          const next = {
            ...draft,
            code: scan.code,
            format: scan.format && formats.includes(scan.format) ? scan.format : 'UNKNOWN',
            source: scan.source === 'MANUAL_CODE' ? 'ADMIN_MANUAL' : 'MANUFACTURER',
          };
          setDraft(next);
          const result = await validate(next);
          if (!result.available) throw new Error(result.message);
          if (scan.source === 'CAMERA') {
            await onAdd({ ...next, code: result.code });
            setDraft(blank);
            setValidation(null);
            return `✓ Code ${result.code} captured & added to product.`;
          }
          return 'Code captured — click "Add code" or press Enter to assign.';
        }}
      />
      <div className="form-grid">
        <Field label="Barcode / QR value">
          <input
            aria-label="Product code value"
            value={draft.code}
            maxLength={512}
            onChange={(e) => change({ code: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
          />
        </Field>
        <Field label="Code type">
          <select value={draft.code_type} onChange={(e) => change({ code_type: e.target.value })}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select value={draft.format} onChange={(e) => change({ format: e.target.value })}>
            {formats.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input value={draft.notes || ''} onChange={(e) => change({ notes: e.target.value })} />
        </Field>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.is_primary}
          onChange={(e) => change({ is_primary: e.target.checked })}
        />
        Use as primary code
      </label>
      {validation && (
        <Message type={validation.available ? 'success' : 'error'}>
          {validation.message}
          {validation.legacy_conflicts?.length > 0 && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!draft.resolve_conflict}
                onChange={(e) => setDraft({ ...draft, resolve_conflict: e.target.checked })}
              />
              Resolve the reported legacy conflict by assigning this code to this product.{' '}
              {validation.legacy_conflicts.map((p: any) => p.name + ' / ' + p.sku).join(', ')}
            </label>
          )}
        </Message>
      )}
      <Message>{error}</Message>
      <div className="scanner-actions">
        <button
          type="button"
          className="button outline"
          disabled={!draft.code.trim() || busy}
          onClick={() => void validate(draft).catch((e) => setError(e.message))}
        >
          Check availability
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!draft.code.trim() || busy}
          onClick={() => void add()}
        >
          Add code
        </button>
        {(['BARCODE', 'QR'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="button outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const code = await post('/product-codes/generate', { kind });
                await onAdd(code);
                setError('');
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Generate {kind === 'QR' ? 'QR' : 'internal barcode'}
          </button>
        ))}
      </div>
    </div>
  );
}
export function DraftCodes({
  codes,
  onChange,
  initialCode,
}: {
  codes: CodeDraft[];
  onChange: (codes: CodeDraft[]) => void;
  initialCode?: string;
}) {
  return (
    <div className="draft-codes">
      <CodeEntry
        existing={codes}
        initialCode={initialCode}
        onAdd={(code) =>
          onChange([
            ...codes.map((c) => (code.is_primary ? { ...c, is_primary: false } : c)),
            { ...code, is_primary: code.is_primary || !codes.length },
          ])
        }
      />
      {codes.map((c, i) => (
        <div className="draft-code" key={c.code}>
          <code>{c.code}</code>
          <span>
            {c.format}
            {c.is_primary ? ' · Primary' : ''}
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => onChange(codes.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
export function ProductCodeManager({ part, admin }: { part: any; admin: boolean }) {
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(''),
    [label, setLabel] = useState<any>(null);
  const codes = useData<any[]>('/parts/' + part.id + '/codes', refresh);
  return (
    <Panel title="Codes & Labels">
      <Message>{error || codes.error}</Message>
      <Table
        rows={codes.data || []}
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'code_type', label: 'Type' },
          { key: 'format', label: 'Format' },
          { key: 'is_primary', label: 'Primary', render: (r) => (r.is_primary ? 'Yes' : '—') },
          {
            key: 'is_active',
            label: 'Status',
            render: (r) => (r.is_active ? 'Active' : 'Disabled'),
          },
          { key: 'created_at', label: 'Created', render: (r) => dateTime(r.created_at) },
          {
            key: 'action',
            label: 'Actions',
            render: (r) => (
              <div className="scanner-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(r.code)
                      .catch(() =>
                        setError('Copy unavailable. Select and copy the displayed code.'),
                      )
                  }
                >
                  Copy value
                </button>
                {admin && (
                  <>
                    {r.is_active && !r.is_primary && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={async () => {
                          try {
                            await patch('/product-codes/' + r.id + '/primary', {});
                            setRefresh((n) => n + 1);
                          } catch (e: any) {
                            setError(e.message);
                          }
                        }}
                      >
                        Set primary
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      onClick={async () => {
                        try {
                          await patch(
                            '/product-codes/' + r.id + (r.is_active ? '/disable' : '/enable'),
                            {},
                          );
                          setRefresh((n) => n + 1);
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      {r.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {r.is_active && (
                      <button type="button" className="link-button" onClick={() => setLabel(r)}>
                        Preview / Print label
                      </button>
                    )}
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      {(codes.data || [])
        .filter((c) => c.is_active)
        .map((c) => (
          <div className="code-preview" key={c.id}>
            <img
              src={'/api/product-codes/' + c.id + '/image'}
              alt={`${c.format} for ${part.name}: ${c.code}`}
            />
            <div>
              <b>{part.name}</b>
              <p>
                OEM {part.oem_number || '—'} · SKU {part.sku}
              </p>
              <code>{c.code}</code>
            </div>
          </div>
        ))}
      {admin && (
        <CodeEntry
          onAdd={async (code) => {
            await post('/product-codes', { ...code, part_id: part.id });
            setRefresh((n) => n + 1);
          }}
        />
      )}
      {label && (
        <LabelPrinter
          items={[{ part_id: part.id, code_id: label.id }]}
          onClose={() => setLabel(null)}
        />
      )}
    </Panel>
  );
}
export function LabelPrinter({
  items,
  onClose,
}: {
  items: { part_id: string; code_id?: string }[];
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1),
    [template, setTemplate] = useState('SMALL'),
    [layout, setLayout] = useState('SHEET'),
    [price, setPrice] = useState(false),
    [oem, setOem] = useState(true),
    [sku, setSku] = useState(true),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <Modal
      title={`Print labels · ${items.length} product${items.length === 1 ? '' : 's'}`}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Labels per product">
          <input
            type="number"
            min="1"
            max="200"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </Field>
        <Field label="Template">
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="SMALL">Small · 67 × 50 mm</option>
            <option value="MINIMAL">Minimal · 60 × 40 mm</option>
          </select>
        </Field>
        <Field label="Paper">
          <select value={layout} onChange={(e) => setLayout(e.target.value)}>
            <option value="SHEET">A4 label sheet</option>
            <option value="ROLL">One label per page / Roll</option>
          </select>
        </Field>
        <label className="check-label">
          <input type="checkbox" checked={price} onChange={(e) => setPrice(e.target.checked)} />
          Show price
        </label>
        <label className="check-label">
          <input type="checkbox" checked={oem} onChange={(e) => setOem(e.target.checked)} />
          Show OEM
        </label>
        <label className="check-label">
          <input type="checkbox" checked={sku} onChange={(e) => setSku(e.target.checked)} />
          Show SKU
        </label>
      </div>
      <Message>{error}</Message>
      <div className="scanner-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await fetch('/api/product-codes/labels', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1' },
                body: JSON.stringify({
                  items: items.map((i) => ({ ...i, quantity })),
                  template,
                  layout,
                  show_price: price,
                  show_oem: oem,
                  show_sku: sku,
                }),
              });
              if (!response.ok)
                throw new Error((await response.json()).error || 'Could not create labels.');
              setUrl(URL.createObjectURL(await response.blob()));
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Preparing…' : 'Generate labels'}
        </button>
        {url && (
          <>
            <a className="button outline" href={url} download="sam-product-labels.pdf">
              Download labels
            </a>
            <button
              type="button"
              className="button outline"
              onClick={() => {
                const tab = window.open(url, '_blank');
                if (tab) tab.addEventListener('load', () => tab.print(), { once: true });
              }}
            >
              Print labels
            </button>
          </>
        )}
      </div>
      {url && (
        <>
          <p className="muted">
            Print at actual size (100%). Keep the white margins around each code.
          </p>
          <iframe className="label-pdf" title="Printable product labels" src={url} />
        </>
      )}
    </Modal>
  );
}
export function AssignCodeModal({
  code,
  onClose,
  onDone,
}: {
  code: string;
  onClose: () => void;
  onDone: (part: any) => void;
}) {
  const [q, setQ] = useState(''),
    [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const parts = useData<any[]>('/parts?activeOnly=true&q=' + encodeURIComponent(q));
  return (
    <Modal title="Assign scanned code" onClose={onClose}>
      <p>
        Code: <code>{code}</code>
      </p>
      <input
        data-scanner-ignore
        aria-label="Find product for code"
        placeholder="Search product, OEM or SKU"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Table
        rows={parts.data || []}
        columns={[
          { key: 'name', label: 'Product' },
          { key: 'oem_number', label: 'OEM' },
          { key: 'sku', label: 'SKU' },
        ]}
        onRow={setSelected}
      />
      {selected && (
        <div className="message info">
          Assign <b>{code}</b> to <b>{selected.name}</b> — {selected.oem_number || selected.sku}?
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post('/product-codes', { part_id: selected.id, code });
                onDone(selected);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm assignment
          </button>
        </div>
      )}
      <Message>{error}</Message>
    </Modal>
  );
}
