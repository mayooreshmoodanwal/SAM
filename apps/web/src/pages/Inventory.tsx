import React, { useState } from 'react';
import { api, post, patch, rupees, paise, dateTime } from '../api';
import { Panel, Table, Modal, Field, Message, Loading, Badge, useData } from '../ui';
import type { Nav } from '../App';
export function Parts({ navigate, admin }: { navigate: Nav; admin: boolean }) {
  const [q, setQ] = useState(''),
    [category, setCategory] = useState(''),
    [refresh, setRefresh] = useState(0),
    [categoryRefresh, setCategoryRefresh] = useState(0),
    [adding, setAdding] = useState(false),
    [importing, setImporting] = useState(false),
    [addingCategory, setAddingCategory] = useState(false);
  const { data, loading, error } = useData(
      `/parts?q=${encodeURIComponent(q)}&category=${category}&limit=100`,
      refresh,
    ),
    cats = useData('/categories', categoryRefresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">PART MASTER</p>
          <h1>Parts</h1>
          <p>OEM numbers, fitment, shelf locations and available stock.</p>
        </div>
        {admin && (
          <div className="title-actions">
            <button className="button outline" onClick={() => setAddingCategory(true)}>
              Categories
            </button>
            <button className="button outline" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="button primary" onClick={() => setAdding(true)}>
              ＋ Add part
            </button>
          </div>
        )}
      </div>
      <div className="filterbar">
        <input
          className="search-input"
          placeholder="Search name, OEM, SKU or barcode"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {(cats.data || []).map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Panel title="Part catalogue">
        {loading ? (
          <Loading />
        ) : error ? (
          <Message>{error}</Message>
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'name', label: 'Part' },
              { key: 'oem_number', label: 'OEM no.' },
              { key: 'sku', label: 'SKU' },
              { key: 'category', label: 'Category' },
              { key: 'brand', label: 'Brand' },
              {
                key: 'selling_price_paise',
                label: 'Selling',
                render: (r) => rupees(r.selling_price_paise),
              },
              {
                key: 'available_stock',
                label: 'Available',
                render: (r) => (
                  <Badge tone={Number(r.available_stock) <= Number(r.min_stock) ? 'warn' : 'good'}>
                    {r.available_stock}
                  </Badge>
                ),
              },
              {
                key: 'rack',
                label: 'Rack / bin',
                render: (r) => `${r.rack || '—'} / ${r.bin || '—'}`,
              },
            ]}
            onRow={(r) => navigate('parts/' + r.id)}
            empty="No parts match this search."
          />
        )}
      </Panel>
      {adding && (
        <NewPart
          categories={cats.data || []}
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setRefresh(refresh + 1);
            navigate('parts/' + id);
          }}
        />
      )}
      {addingCategory && (
        <CategoryManager
          onClose={() => setAddingCategory(false)}
          onDone={() => setCategoryRefresh(categoryRefresh + 1)}
        />
      )}
      {importing && (
        <ImportParts
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
    </>
  );
}
function CategoryManager({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(''),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    { data } = useData('/categories?all=true', refresh);
  const changed = () => {
    setRefresh(refresh + 1);
    onDone();
  };
  return (
    <Modal title="Categories" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/categories', { name });
            setName('');
            setError('');
            changed();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="New category">
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button className="button primary">Add category</button>
          </div>
        </div>
      </form>
      <Table
        rows={data || []}
        columns={[
          { key: 'name', label: 'Category' },
          { key: 'active', label: 'Status', render: (r) => (r.active ? 'Active' : 'Archived') },
          {
            key: 'action',
            label: '',
            render: (r) => (
              <div className="title-actions">
                <button
                  className="link-button"
                  onClick={async () => {
                    const next = prompt('Category name', r.name);
                    if (!next) return;
                    try {
                      await patch('/categories/' + r.id, { name: next });
                      changed();
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  Rename
                </button>
                <button
                  className="link-button"
                  onClick={async () => {
                    try {
                      await patch('/categories/' + r.id, { active: !r.active });
                      changed();
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  {r.active ? 'Archive' : 'Restore'}
                </button>
              </div>
            ),
          },
        ]}
      />
      <div style={{ margin: '0 16px' }}>
        <Message>{error}</Message>
      </div>
    </Modal>
  );
}
function ImportParts({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState(''),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Import parts from CSV" onClose={onClose}>
      <div className="import-area">
        <p className="muted">
          Use the template columns, save your Excel sheet as CSV, then review every row before
          importing.
        </p>
        <a className="button outline" href="/api/parts/import/template">
          Download CSV template
        </a>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              setCsv(await file.text());
              setPreview(null);
              setError('');
            }
          }}
        />
        {csv && (
          <button
            className="button outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setPreview(await post('/parts/import/preview', { csv }));
                setError('');
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview import
          </button>
        )}
        {preview && (
          <>
            <div className="import-summary">
              <Badge tone="good">{preview.valid.length} valid</Badge>
              <Badge tone={preview.invalid.length ? 'bad' : 'good'}>
                {preview.invalid.length} invalid
              </Badge>
              <Badge tone={preview.duplicates.length ? 'warn' : 'good'}>
                {preview.duplicates.length} duplicate
              </Badge>
            </div>
            {!!preview.invalid.length && (
              <Table
                rows={preview.invalid}
                columns={[
                  { key: 'row', label: 'Row' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'errors', label: 'Errors', render: (r) => r.errors.join('; ') },
                ]}
              />
            )}
            {!!preview.duplicates.length && (
              <Table
                rows={preview.duplicates}
                columns={[
                  { key: 'row', label: 'Row' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'reason', label: 'Issue' },
                ]}
              />
            )}
            {!!preview.valid.length && (
              <Table
                rows={preview.valid.slice(0, 20)}
                columns={[
                  { key: 'row', label: 'Row' },
                  { key: 'name', label: 'Part' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'opening_stock', label: 'Opening stock' },
                ]}
              />
            )}
          </>
        )}
        <Message>{error}</Message>
        <div className="form-actions">
          <button
            className="button primary"
            disabled={
              busy || !preview?.valid?.length || preview.invalid.length || preview.duplicates.length
            }
            onClick={async () => {
              setBusy(true);
              try {
                await post('/parts/import', { csv });
                onDone();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {preview?.valid?.length || 0} parts
          </button>
        </div>
      </div>
    </Modal>
  );
}
function NewPart({
  categories,
  onClose,
  onDone,
}: {
  categories: any[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const settings = useData('/settings');
  const [v, setV] = useState<any>({
    name: '',
    sku: '',
    oem_number: '',
    category_id: '',
    brand: 'Ashok Leyland',
    selling: '',
    purchase: '',
    mrp: '',
    tax_mode: 'INCLUSIVE',
    gst: '',
    opening_stock: 0,
    min_stock: 2,
    reorder_level: 3,
    reorder_quantity: 5,
    rack: '',
    bin: '',
    hsn: '8708',
    warranty_months: 0,
  });
  const [error, setError] = useState('');
  const change = (key: string, value: any) => setV({ ...v, [key]: value });
  return (
    <Modal title="Add part" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const part = await post('/parts', {
              name: v.name,
              sku: v.sku,
              oem_number: v.oem_number || null,
              category_id: v.category_id || null,
              brand: v.brand,
              selling_price_paise: paise(v.selling),
              purchase_price_paise: paise(v.purchase),
              mrp_paise: paise(v.mrp),
              tax_mode: v.tax_mode,
              gst_bps: v.gst === '' ? undefined : Number(v.gst) * 100,
              opening_stock: Number(v.opening_stock),
              min_stock: Number(v.min_stock),
              reorder_level: Number(v.reorder_level),
              reorder_quantity: Number(v.reorder_quantity),
              rack: v.rack || null,
              bin: v.bin || null,
              hsn: v.hsn || null,
              warranty_months: Number(v.warranty_months),
            });
            onDone(part.id);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          {[
            ['name', 'Part name'],
            ['sku', 'Internal SKU'],
            ['oem_number', 'OEM part no.'],
            ['brand', 'Brand'],
            ['hsn', 'HSN code'],
            ['rack', 'Rack'],
            ['bin', 'Bin'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                required={key === 'name' || key === 'sku'}
                value={
                  key === 'gst' && v.gst === ''
                    ? Number(settings.data?.default_gst_bps ?? 1800) / 100
                    : v[key]
                }
                onChange={(e) => change(key, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Category">
            <select value={v.category_id} onChange={(e) => change('category_id', e.target.value)}>
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {[
            ['purchase', 'Purchase price ₹'],
            ['selling', 'Selling price ₹'],
            ['mrp', 'MRP ₹'],
            ['gst', 'GST %'],
            ['opening_stock', 'Opening stock'],
            ['min_stock', 'Minimum stock'],
            ['reorder_level', 'Reorder level'],
            ['reorder_quantity', 'Reorder quantity'],
            ['warranty_months', 'Warranty months'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min="0"
                step={['purchase', 'selling', 'mrp'].includes(key) ? '0.01' : '1'}
                required={key === 'selling'}
                value={v[key]}
                onChange={(e) => change(key, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Price tax mode">
            <select value={v.tax_mode} onChange={(e) => change('tax_mode', e.target.value)}>
              <option value="INCLUSIVE">Tax inclusive</option>
              <option value="EXCLUSIVE">Tax exclusive</option>
              <option value="EXEMPT">Tax exempt</option>
            </select>
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save part</button>
        </div>
      </form>
    </Modal>
  );
}
export function PartDetail({ id, navigate, admin }: { id: string; navigate: Nav; admin: boolean }) {
  const [tab, setTab] = useState('Overview'),
    [refresh, setRefresh] = useState(0),
    [showCompat, setShowCompat] = useState(false),
    [editing, setEditing] = useState(false);
  const { data: p, loading, error } = useData('/parts/' + id, refresh),
    config = useData('/vehicle-configurations');
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  const tabs = [
    'Overview',
    'Stock',
    'Compatibility',
    'Purchases',
    'Sales',
    'Price History',
    'Suppliers',
    'Warranty',
  ];
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">PART DETAIL · {p?.sku}</p>
          <h1>{p?.name}</h1>
          <p>
            OEM {p?.oem_number || '—'} · {p?.brand} · {p?.part_type}
          </p>
        </div>
        <div className="title-actions">
          <Badge tone={Number(p?.available_stock) <= Number(p?.min_stock) ? 'warn' : 'good'}>
            {p?.available_stock} available
          </Badge>
          {admin && (
            <button className="button outline" onClick={() => setEditing(true)}>
              Edit part
            </button>
          )}
          <button className="button primary" onClick={() => navigate('billing/' + id)}>
            Add to invoice
          </button>
        </div>
      </div>
      <div className="kpi-grid compact">
        <div className="kpi">
          <small>Selling price</small>
          <strong>{rupees(p?.selling_price_paise)}</strong>
        </div>
        <div className="kpi">
          <small>MRP</small>
          <strong>{rupees(p?.mrp_paise)}</strong>
        </div>
        <div className="kpi">
          <small>Current stock</small>
          <strong>{p?.current_stock}</strong>
        </div>
        <div className="kpi">
          <small>Rack / bin</small>
          <strong>
            {p?.rack || '—'} / {p?.bin || '—'}
          </strong>
        </div>
      </div>
      <div className="tabs">
        {tabs
          .filter((t) => admin || !['Purchases', 'Price History', 'Suppliers'].includes(t))
          .map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
      </div>
      {tab === 'Overview' && (
        <Panel title="Part information">
          <div className="detail-grid">
            {[
              ['Category', p?.category],
              ['Brand', p?.brand],
              ['Type', p?.part_type],
              ['Unit', p?.unit],
              ['HSN', p?.hsn],
              ['GST', `${Number(p?.gst_bps) / 100}%`],
              ['Tax mode', p?.tax_mode],
              ['Minimum stock', p?.min_stock],
              ['Reorder level', p?.reorder_level],
              ['Warranty', `${p?.warranty_months} months`],
              ['Barcode', p?.barcode],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <small>{k}</small>
                <strong>{v || '—'}</strong>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {tab === 'Stock' && (
        <Panel title="Stock ledger">
          <Table
            rows={p?.ledger || []}
            columns={[
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
              { key: 'type', label: 'Movement' },
              { key: 'quantity', label: 'Qty' },
              { key: 'previous_stock', label: 'Previous' },
              { key: 'new_stock', label: 'New' },
              { key: 'reference_type', label: 'Reference' },
              { key: 'reason', label: 'Reason' },
            ]}
          />
        </Panel>
      )}
      {tab === 'Compatibility' && (
        <Panel
          title="Compatible vehicles"
          action={
            admin ? (
              <button className="button outline" onClick={() => setShowCompat(true)}>
                ＋ Link vehicle
              </button>
            ) : undefined
          }
        >
          <Table
            rows={p?.compatibility || []}
            columns={[
              { key: 'model', label: 'Model' },
              { key: 'variant', label: 'Variant' },
              { key: 'engine_model', label: 'Engine' },
              { key: 'emission_standard', label: 'BS' },
              { key: 'axle_configuration', label: 'Axle' },
            ]}
          />
        </Panel>
      )}
      {tab === 'Purchases' && (
        <Panel title="Purchase history">
          <Table
            rows={p?.purchases || []}
            columns={[
              { key: 'purchase_number', label: 'Purchase' },
              { key: 'supplier', label: 'Supplier' },
              { key: 'rate_paise', label: 'Rate', render: (r) => rupees(r.rate_paise) },
              { key: 'quantity_received', label: 'Qty' },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
          />
        </Panel>
      )}
      {tab === 'Sales' && (
        <Panel title="Sales history">
          <Table
            rows={p?.sales || []}
            columns={[
              { key: 'invoice_number', label: 'Invoice' },
              { key: 'quantity', label: 'Qty' },
              { key: 'rate_paise', label: 'Rate', render: (r) => rupees(r.rate_paise) },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
          />
        </Panel>
      )}
      {tab === 'Price History' && (
        <Panel title="Price changes">
          <Table
            rows={p?.priceHistory || []}
            columns={[
              { key: 'changed_at', label: 'Date', render: (r) => dateTime(r.changed_at) },
              { key: 'source', label: 'Source' },
              {
                key: 'old_purchase_paise',
                label: 'Old cost',
                render: (r) => rupees(r.old_purchase_paise),
              },
              {
                key: 'new_purchase_paise',
                label: 'New cost',
                render: (r) => rupees(r.new_purchase_paise),
              },
              {
                key: 'old_selling_paise',
                label: 'Old selling',
                render: (r) => rupees(r.old_selling_paise),
              },
              {
                key: 'new_selling_paise',
                label: 'New selling',
                render: (r) => rupees(r.new_selling_paise),
              },
              { key: 'changed_by_name', label: 'Changed by' },
            ]}
          />
        </Panel>
      )}
      {tab === 'Suppliers' && (
        <Panel title="Supplier rate history">
          <Table
            rows={p?.purchases || []}
            columns={[
              { key: 'supplier', label: 'Supplier' },
              { key: 'purchase_number', label: 'Purchase' },
              { key: 'rate_paise', label: 'Rate', render: (r) => rupees(r.rate_paise) },
              { key: 'quantity_received', label: 'Received' },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
          />
        </Panel>
      )}
      {tab === 'Warranty' && (
        <Panel title="Warranty claims">
          <Table
            rows={p?.warranties || []}
            columns={[
              { key: 'claim_number', label: 'Claim' },
              { key: 'status', label: 'Status' },
              { key: 'complaint', label: 'Complaint' },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
          />
        </Panel>
      )}
      {showCompat && (
        <LinkVehicle
          partId={id}
          configurations={config.data || []}
          onClose={() => setShowCompat(false)}
          onDone={() => {
            setShowCompat(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {editing && (
        <EditPart
          part={p}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
    </>
  );
}
function EditPart({
  part,
  onClose,
  onDone,
}: {
  part: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [v, setV] = useState<any>({
      name: part.name,
      oem_number: part.oem_number || '',
      selling: String(Number(part.selling_price_paise) / 100),
      purchase: String(Number(part.purchase_price_paise) / 100),
      mrp: String(Number(part.mrp_paise) / 100),
      gst: Number(part.gst_bps) / 100,
      tax_mode: part.tax_mode,
      min_stock: part.min_stock,
      reorder_level: part.reorder_level,
      rack: part.rack || '',
      bin: part.bin || '',
      active: part.active,
    }),
    [error, setError] = useState('');
  const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return (
    <Modal title={`Edit ${part.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await patch('/parts/' + part.id, {
              name: v.name,
              oem_number: v.oem_number || null,
              selling_price_paise: paise(v.selling),
              purchase_price_paise: paise(v.purchase),
              mrp_paise: paise(v.mrp),
              gst_bps: Math.round(Number(v.gst) * 100),
              tax_mode: v.tax_mode,
              min_stock: Number(v.min_stock),
              reorder_level: Number(v.reorder_level),
              rack: v.rack || null,
              bin: v.bin || null,
              active: v.active,
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          {[
            ['name', 'Part name'],
            ['oem_number', 'OEM number'],
            ['selling', 'Selling price ₹'],
            ['purchase', 'Purchase price ₹'],
            ['mrp', 'MRP ₹'],
            ['gst', 'GST %'],
            ['min_stock', 'Minimum stock'],
            ['reorder_level', 'Reorder level'],
            ['rack', 'Rack'],
            ['bin', 'Bin'],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                required={k === 'name' || k === 'selling'}
                value={v[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Tax mode">
            <select value={v.tax_mode} onChange={(e) => set('tax_mode', e.target.value)}>
              <option value="INCLUSIVE">Inclusive</option>
              <option value="EXCLUSIVE">Exclusive</option>
              <option value="EXEMPT">Exempt</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={v.active ? 'ACTIVE' : 'ARCHIVED'}
              onChange={(e) => set('active', e.target.value === 'ACTIVE')}
            >
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save changes</button>
        </div>
      </form>
    </Modal>
  );
}
function LinkVehicle({
  partId,
  configurations,
  onClose,
  onDone,
}: {
  partId: string;
  configurations: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [id, setId] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Link compatible vehicle" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/parts/' + partId + '/compatibility', { configuration_id: id });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <Field label="Vehicle configuration">
          <select required value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Select model</option>
            {configurations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.model} · {c.variant} · {c.emission_standard}
              </option>
            ))}
          </select>
        </Field>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Link vehicle</button>
        </div>
      </form>
    </Modal>
  );
}
export function VehicleLookup({ navigate }: { navigate: Nav }) {
  const [q, setQ] = useState(''),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(''),
    [available, setAvailable] = useState(false),
    [category, setCategory] = useState(''),
    [brand, setBrand] = useState(''),
    [partType, setPartType] = useState('');
  const allParts = data?.parts || [];
  const parts = allParts.filter(
    (p: any) =>
      (!filter ||
        [p.name, p.oem_number, p.brand, p.category].some((x) =>
          String(x || '')
            .toLowerCase()
            .includes(filter.toLowerCase()),
        )) &&
      (!available || Number(p.available_stock) > 0) &&
      (!category || p.category === category) &&
      (!brand || p.brand === brand) &&
      (!partType || p.part_type === partType),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">VEHICLE-BASED FITMENT</p>
          <h1>Vehicle Lookup</h1>
          <p>Find a registered truck by registration, chassis number or VIN.</p>
        </div>
      </div>
      <Panel title="Identify truck">
        <form
          className="lookup-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              setData(await api('/vehicles/lookup/' + encodeURIComponent(q.trim())));
            } catch (e: any) {
              setData(null);
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            autoFocus
            required
            placeholder="e.g. UP65 BT 1234 or chassis number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="button primary" disabled={busy}>
            {busy ? 'Looking up…' : 'Find vehicle'}
          </button>
        </form>
        <Message>{error}</Message>
      </Panel>
      {data && (
        <>
          <Panel title="Vehicle configuration">
            <div className="vehicle-identity">
              <div>
                <strong>{data.vehicle.registration_number || data.vehicle.chassis_number}</strong>
                <span>{data.vehicle.customer_name}</span>
              </div>
              <Badge tone="good">MATCHED VEHICLE</Badge>
            </div>
            <div className="detail-grid">
              {[
                ['Model', data.vehicle.model],
                ['Variant', data.vehicle.variant],
                ['Engine', data.vehicle.engine_model],
                ['Gearbox', data.vehicle.gearbox_model],
                ['Axle', data.vehicle.axle_configuration],
                ['Emission', data.vehicle.emission_standard],
                ['Manufacturing year', data.vehicle.manufacturing_year],
                ['Chassis', data.vehicle.chassis_number],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <small>{k}</small>
                  <strong>{v || '—'}</strong>
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title={`Compatible parts · ${parts.length}`}
            action={
              <div className="inline-filters">
                <input
                  placeholder="Part name or OEM…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {[...new Set(allParts.map((p: any) => p.category).filter(Boolean))].map(
                    (x: any) => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
                <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                  <option value="">All brands</option>
                  {[...new Set(allParts.map((p: any) => p.brand).filter(Boolean))].map((x: any) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select value={partType} onChange={(e) => setPartType(e.target.value)}>
                  <option value="">All types</option>
                  <option value="GENUINE">Genuine</option>
                  <option value="AFTERMARKET">Aftermarket</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={available}
                    onChange={(e) => setAvailable(e.target.checked)}
                  />{' '}
                  In stock
                </label>
              </div>
            }
          >
            <Table
              rows={parts}
              columns={[
                { key: 'name', label: 'Part' },
                { key: 'oem_number', label: 'OEM' },
                { key: 'category', label: 'Category' },
                { key: 'brand', label: 'Brand' },
                { key: 'part_type', label: 'Type' },
                {
                  key: 'selling_price_paise',
                  label: 'Selling',
                  render: (r) => rupees(r.selling_price_paise),
                },
                {
                  key: 'available_stock',
                  label: 'Available',
                  render: (r) => (
                    <Badge tone={Number(r.available_stock) > 0 ? 'good' : 'bad'}>
                      {r.available_stock}
                    </Badge>
                  ),
                },
                { key: 'rack', label: 'Rack' },
                {
                  key: 'action',
                  label: '',
                  render: (r) => (
                    <button
                      className="button small primary"
                      onClick={() =>
                        navigate(
                          `billing/${r.id}?customer=${data.vehicle.customer_id}&vehicle=${data.vehicle.id}`,
                        )
                      }
                    >
                      Bill part
                    </button>
                  ),
                },
              ]}
              empty="No compatible parts match these filters."
            />
          </Panel>
        </>
      )}
    </>
  );
}
export function Stock({ navigate, admin }: { navigate: Nav; admin: boolean }) {
  const [status, setStatus] = useState(''),
    [tab, setTab] = useState('position'),
    [refresh, setRefresh] = useState(0),
    [adjust, setAdjust] = useState(false),
    [reserve, setReserve] = useState(false);
  const stock = useData('/stock?status=' + status, refresh),
    ledger = useData('/stock/ledger', refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">INVENTORY CONTROL</p>
          <h1>Stock</h1>
          <p>Live available quantities with a full movement trail.</p>
        </div>
        {admin && (
          <div className="title-actions">
            <button className="button outline" onClick={() => setReserve(true)}>
              Reserve stock
            </button>
            <button className="button primary" onClick={() => setAdjust(true)}>
              ＋ Stock adjustment
            </button>
          </div>
        )}
      </div>
      <div className="tabs">
        <button className={tab === 'position' ? 'active' : ''} onClick={() => setTab('position')}>
          Stock position
        </button>
        <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>
          Stock ledger
        </button>
        {admin && (
          <button
            className={tab === 'reservations' ? 'active' : ''}
            onClick={() => setTab('reservations')}
          >
            Reservations
          </button>
        )}
      </div>
      {tab === 'position' ? (
        <>
          <div className="filterbar">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All stock</option>
              <option value="LOW">Low stock</option>
              <option value="OUT">Out of stock</option>
            </select>
          </div>
          <Panel title="Inventory position">
            {stock.loading ? (
              <Loading />
            ) : (
              <Table
                rows={stock.data || []}
                columns={[
                  { key: 'name', label: 'Part' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'current_stock', label: 'Current' },
                  { key: 'reserved_stock', label: 'Reserved' },
                  {
                    key: 'available_stock',
                    label: 'Available',
                    render: (r) => (
                      <Badge
                        tone={Number(r.available_stock) <= Number(r.min_stock) ? 'warn' : 'good'}
                      >
                        {r.available_stock}
                      </Badge>
                    ),
                  },
                  { key: 'damaged_stock', label: 'Damaged' },
                  { key: 'min_stock', label: 'Minimum' },
                  { key: 'rack', label: 'Rack' },
                  ...(admin
                    ? [
                        {
                          key: 'stock_value_paise',
                          label: 'Stock value',
                          render: (r: any) => rupees(r.stock_value_paise),
                        },
                      ]
                    : []),
                ]}
                onRow={(r) => navigate('parts/' + r.id)}
              />
            )}
          </Panel>
        </>
      ) : tab === 'ledger' ? (
        <Panel title="Recent stock movements">
          {ledger.loading ? (
            <Loading />
          ) : (
            <Table
              rows={ledger.data || []}
              columns={[
                { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
                { key: 'part_name', label: 'Part' },
                { key: 'type', label: 'Type' },
                { key: 'quantity', label: 'Qty' },
                { key: 'previous_stock', label: 'Previous' },
                { key: 'new_stock', label: 'New' },
                { key: 'reference_type', label: 'Reference' },
                { key: 'user_name', label: 'By' },
              ]}
            />
          )}
        </Panel>
      ) : (
        <Reservations refresh={refresh} onChange={() => setRefresh(refresh + 1)} />
      )}
      {adjust && (
        <AdjustStock
          parts={stock.data || []}
          onClose={() => setAdjust(false)}
          onDone={() => {
            setAdjust(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {reserve && (
        <ReserveStock
          parts={stock.data || []}
          onClose={() => setReserve(false)}
          onDone={() => {
            setReserve(false);
            setRefresh(refresh + 1);
            setTab('reservations');
          }}
        />
      )}
    </>
  );
}
function ReserveStock({
  parts,
  onClose,
  onDone,
}: {
  parts: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [part, setPart] = useState(''),
    [quantity, setQuantity] = useState(1),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Reserve stock" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/stock/reservations', {
              part_id: part,
              quantity: Number(quantity),
              reference,
              reason,
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Part">
            <select required value={part} onChange={(e) => setPart(e.target.value)}>
              <option value="">Select part</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.available_stock} available
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              min="1"
              required
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </Field>
          <Field label="Order / reference">
            <input required value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Reason">
            <input
              required
              minLength={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Reserve stock</button>
        </div>
      </form>
    </Modal>
  );
}
function Reservations({ refresh, onChange }: { refresh: number; onChange: () => void }) {
  const { data, loading } = useData('/stock/reservations', refresh),
    [error, setError] = useState('');
  return (
    <Panel title="Open reservations">
      <Message>{error}</Message>
      {loading ? (
        <Loading />
      ) : (
        <Table
          rows={data || []}
          columns={[
            { key: 'part_name', label: 'Part' },
            { key: 'reference', label: 'Reference' },
            { key: 'quantity', label: 'Reserved' },
            { key: 'released_quantity', label: 'Released' },
            { key: 'reason', label: 'Reason' },
            { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            {
              key: 'action',
              label: '',
              render: (r) => (
                <button
                  className="button small outline"
                  onClick={async () => {
                    const reason = prompt('Reason for release');
                    if (!reason) return;
                    try {
                      await post(`/stock/reservations/${r.id}/release`, {
                        quantity: Number(r.quantity) - Number(r.released_quantity),
                        reason,
                      });
                      onChange();
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  Release remaining
                </button>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}
function AdjustStock({
  parts,
  onClose,
  onDone,
}: {
  parts: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [part, setPart] = useState(''),
    [delta, setDelta] = useState(0),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Stock adjustment" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/stock/adjustments', { part_id: part, delta: Number(delta), reason });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Part">
            <select required value={part} onChange={(e) => setPart(e.target.value)}>
              <option value="">Select part</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.current_stock} in stock
                </option>
              ))}
            </select>
          </Field>
          <Field label="Change in quantity">
            <input
              type="number"
              required
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Reason">
          <input
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Record adjustment</button>
        </div>
      </form>
    </Modal>
  );
}
