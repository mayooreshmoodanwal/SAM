import React, { useState } from 'react';
import { api, post, rupees, paise, dateTime } from '../api';
import { Panel, Table, Modal, Field, Message, Loading, Badge, useData } from '../ui';
import type { Nav } from '../App';
import { CustomerHistory, VehicleHistory, SupplierHistory, PurchaseHistory } from './RecordHistory';
export function Customers({ navigate }: { navigate: Nav }) {
  const [q, setQ] = useState(''),
    [adding, setAdding] = useState(false),
    [refresh, setRefresh] = useState(0),
    { data, loading } = useData('/customers?q=' + encodeURIComponent(q), refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">CUSTOMER & FLEET MASTER</p>
          <h1>Customers / Fleets</h1>
          <p>Customer balances, trucks and purchase history.</p>
        </div>
        <button className="button primary" onClick={() => setAdding(true)}>
          ＋ Add customer
        </button>
      </div>
      <div className="filterbar">
        <input
          className="search-input"
          placeholder="Search name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Panel title="Customer directory">
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'name', label: 'Customer' },
              { key: 'type', label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
              { key: 'phone', label: 'Phone' },
              { key: 'gstin', label: 'GSTIN' },
              {
                key: 'outstanding_paise',
                label: 'Outstanding',
                render: (r) => rupees(r.outstanding_paise),
              },
              {
                key: 'credit_limit_paise',
                label: 'Credit limit',
                render: (r) => rupees(r.credit_limit_paise),
              },
            ]}
            onRow={(r) => navigate('customers/' + r.id)}
            empty="No customers added yet."
          />
        )}
      </Panel>
      {adding && (
        <CustomerForm
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setRefresh(refresh + 1);
            navigate('customers/' + id);
          }}
        />
      )}
    </>
  );
}
function CustomerForm({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [v, setV] = useState<any>({
      type: 'INDIVIDUAL',
      name: '',
      company_name: '',
      phone: '',
      gstin: '',
      credit_limit: '0',
      credit_period_days: 0,
      billing_address: '',
    }),
    [error, setError] = useState('');
  const set = (k: string, val: any) => setV({ ...v, [k]: val });
  return (
    <Modal title="Add customer / fleet" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await post('/customers', {
              type: v.type,
              name: v.name,
              company_name: v.company_name || null,
              phone: v.phone || null,
              gstin: v.gstin || null,
              credit_limit_paise: paise(v.credit_limit),
              credit_period_days: Number(v.credit_period_days),
              billing_address: v.billing_address || null,
            });
            onDone(r.id);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Customer type">
            <select value={v.type} onChange={(e) => set('type', e.target.value)}>
              <option value="INDIVIDUAL">Individual</option>
              <option value="FLEET">Fleet / company</option>
            </select>
          </Field>
          {[
            ['name', 'Customer name'],
            ['company_name', 'Company / fleet name'],
            ['phone', 'Phone'],
            ['gstin', 'GSTIN'],
            ['billing_address', 'Billing address'],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                required={k === 'name'}
                value={v[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Credit limit ₹">
            <input
              type="number"
              min="0"
              value={v.credit_limit}
              onChange={(e) => set('credit_limit', e.target.value)}
            />
          </Field>
          <Field label="Credit period days">
            <input
              type="number"
              min="0"
              value={v.credit_period_days}
              onChange={(e) => set('credit_period_days', e.target.value)}
            />
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save customer</button>
        </div>
      </form>
    </Modal>
  );
}
export function CustomerDetail({ id, navigate }: { id: string; navigate: Nav }) {
  const { data: c, loading, error } = useData('/customers/' + id);
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">CUSTOMER RECORD</p>
          <h1>{c?.name}</h1>
          <p>
            {c?.company_name || c?.type} · {c?.phone || 'No phone'}
          </p>
        </div>
        <Badge tone={Number(c?.outstanding_paise) > 0 ? 'warn' : 'good'}>
          {rupees(c?.outstanding_paise)} outstanding
        </Badge>
      </div>
      <div className="two-col">
        <Panel title="Registered vehicles">
          <Table
            rows={c?.vehicles || []}
            columns={[
              { key: 'registration_number', label: 'Registration' },
              { key: 'chassis_number', label: 'Chassis' },
              { key: 'model', label: 'Model' },
              { key: 'variant', label: 'Variant' },
            ]}
            onRow={(r) => navigate('vehicles/' + r.id)}
          />
          <button className="button outline" onClick={() => navigate('vehicles')}>
            ＋ Add vehicle
          </button>
        </Panel>
        <Panel title="Sales history">
          <Table
            rows={c?.invoices || []}
            columns={[
              { key: 'invoice_number', label: 'Invoice' },
              { key: 'total_paise', label: 'Total', render: (r) => rupees(r.total_paise) },
              { key: 'pending_paise', label: 'Pending', render: (r) => rupees(r.pending_paise) },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
            onRow={(r) => navigate('invoices/' + r.id)}
          />
        </Panel>
      </div>
      <Panel title="Warranty claims">
        <Table
          rows={c?.warranties || []}
          columns={[
            { key: 'claim_number', label: 'Claim' },
            { key: 'complaint', label: 'Complaint' },
            { key: 'status', label: 'Status' },
            { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
          ]}
        />
      </Panel>
      <CustomerHistory data={c} />
    </>
  );
}
export function Vehicles({ navigate }: { navigate: Nav }) {
  const [q, setQ] = useState(''),
    [adding, setAdding] = useState(false),
    [addingConfig, setAddingConfig] = useState(false),
    [refresh, setRefresh] = useState(0),
    { data, loading } = useData('/vehicles?q=' + encodeURIComponent(q), refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">TRUCK HISTORY</p>
          <h1>Customer vehicles</h1>
          <p>Permanent registration, chassis and VIN records.</p>
        </div>
        <div className="title-actions">
          <button className="button outline" onClick={() => setAddingConfig(true)}>
            ＋ Model configuration
          </button>
          <button className="button primary" onClick={() => setAdding(true)}>
            ＋ Add vehicle
          </button>
        </div>
      </div>
      <div className="filterbar">
        <input
          className="search-input"
          placeholder="Registration, chassis or VIN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Panel title="Vehicle register">
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'registration_number', label: 'Registration' },
              { key: 'chassis_number', label: 'Chassis' },
              { key: 'customer_name', label: 'Customer' },
              { key: 'model', label: 'Model' },
              { key: 'variant', label: 'Variant' },
              { key: 'emission_standard', label: 'BS standard' },
            ]}
            onRow={(r) => navigate('vehicles/' + r.id)}
          />
        )}
      </Panel>
      {adding && (
        <VehicleForm
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setRefresh(refresh + 1);
            navigate('vehicles/' + id);
          }}
        />
      )}
      {addingConfig && (
        <ConfigForm onClose={() => setAddingConfig(false)} onDone={() => setAddingConfig(false)} />
      )}
    </>
  );
}
function ConfigForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({
      make: 'Ashok Leyland',
      model: '',
      model_series: '',
      vehicle_type: 'Truck',
      variant: '',
      engine_model: '',
      emission_standard: 'BS6',
      fuel_type: 'Diesel',
      axle_configuration: '4x2',
      gearbox_model: '',
      year_from: '',
      year_to: '',
    }),
    [error, setError] = useState('');
  const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return (
    <Modal title="Add vehicle configuration" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/vehicle-configurations', {
              ...v,
              year_from: v.year_from ? Number(v.year_from) : undefined,
              year_to: v.year_to ? Number(v.year_to) : undefined,
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          {[
            ['make', 'Make'],
            ['model', 'Model'],
            ['model_series', 'Series'],
            ['variant', 'Variant'],
            ['engine_model', 'Engine'],
            ['gearbox_model', 'Gearbox'],
            ['year_from', 'Year from'],
            ['year_to', 'Year to'],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                required={k === 'model'}
                value={v[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Vehicle type">
            <select value={v.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value)}>
              {['Truck', 'Tipper', 'Tractor', 'Bus', 'Other Commercial Vehicle'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Emission">
            <select
              value={v.emission_standard}
              onChange={(e) => set('emission_standard', e.target.value)}
            >
              {['BS3', 'BS4', 'BS6'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Fuel">
            <input value={v.fuel_type} onChange={(e) => set('fuel_type', e.target.value)} />
          </Field>
          <Field label="Axle">
            <select
              value={v.axle_configuration}
              onChange={(e) => set('axle_configuration', e.target.value)}
            >
              {['4x2', '6x2', '6x4', '8x2', '8x4'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save configuration</button>
        </div>
      </form>
    </Modal>
  );
}
function VehicleForm({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const customers = useData('/customers'),
    configs = useData('/vehicle-configurations');
  const [v, setV] = useState<any>({
      customer_id: '',
      configuration_id: '',
      registration_number: '',
      chassis_number: '',
      vin: '',
      engine_number: '',
      manufacturing_year: '',
    }),
    [error, setError] = useState('');
  const set = (k: string, val: any) => setV({ ...v, [k]: val });
  return (
    <Modal title="Add customer vehicle" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await post('/vehicles', {
              customer_id: v.customer_id,
              configuration_id: v.configuration_id || null,
              registration_number: v.registration_number || null,
              chassis_number: v.chassis_number || null,
              vin: v.vin || null,
              engine_number: v.engine_number || null,
              manufacturing_year: v.manufacturing_year ? Number(v.manufacturing_year) : null,
            });
            onDone(r.id);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Customer">
            <select
              required
              value={v.customer_id}
              onChange={(e) => set('customer_id', e.target.value)}
            >
              <option value="">Select customer</option>
              {(customers.data || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle configuration">
            <select
              value={v.configuration_id}
              onChange={(e) => set('configuration_id', e.target.value)}
            >
              <option value="">Select model</option>
              {(configs.data || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.model} · {c.variant}
                </option>
              ))}
            </select>
          </Field>
          {[
            ['registration_number', 'Registration number'],
            ['chassis_number', 'Chassis number'],
            ['vin', 'VIN'],
            ['engine_number', 'Engine number'],
            ['manufacturing_year', 'Manufacturing year'],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input value={v[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save vehicle</button>
        </div>
      </form>
    </Modal>
  );
}
export function VehicleDetail({ id, navigate }: { id: string; navigate: Nav }) {
  const { data: v, loading, error } = useData('/vehicles/' + id);
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">VEHICLE RECORD</p>
          <h1>{v?.registration_number || v?.chassis_number}</h1>
          <p>
            {v?.customer_name} · {v?.model} {v?.variant}
          </p>
        </div>
        <button className="button primary" onClick={() => navigate('lookup')}>
          Find compatible parts
        </button>
      </div>
      <Panel title="Truck configuration">
        <div className="detail-grid">
          {[
            ['Chassis', v?.chassis_number],
            ['VIN', v?.vin],
            ['Engine', v?.engine_model],
            ['Gearbox', v?.gearbox_model],
            ['Axle', v?.axle_configuration],
            ['BS standard', v?.emission_standard],
            ['Manufacturing year', v?.manufacturing_year],
            ['Odometer', v?.current_odometer],
          ].map(([k, val]) => (
            <div key={String(k)}>
              <small>{k}</small>
              <strong>{val || '—'}</strong>
            </div>
          ))}
        </div>
      </Panel>
      <div className="two-col">
        <Panel title="Parts & invoice history">
          <Table
            rows={v?.invoices || []}
            columns={[
              { key: 'invoice_number', label: 'Invoice' },
              { key: 'total_paise', label: 'Total', render: (r) => rupees(r.total_paise) },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
            onRow={(r) => navigate('invoices/' + r.id)}
          />
        </Panel>
        <Panel title="Warranty history">
          <Table
            rows={v?.warranties || []}
            columns={[
              { key: 'claim_number', label: 'Claim' },
              { key: 'status', label: 'Status' },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
          />
        </Panel>
      </div>
      <VehicleHistory id={id} />
    </>
  );
}
export function Suppliers({ navigate }: { navigate: Nav }) {
  const [q, setQ] = useState(''),
    [adding, setAdding] = useState(false),
    [refresh, setRefresh] = useState(0),
    { data, loading } = useData('/suppliers?q=' + encodeURIComponent(q), refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">VENDOR MASTER</p>
          <h1>Suppliers</h1>
          <p>Purchase sources, credit terms and balances.</p>
        </div>
        <button className="button primary" onClick={() => setAdding(true)}>
          ＋ Add supplier
        </button>
      </div>
      <div className="filterbar">
        <input
          className="search-input"
          placeholder="Search supplier or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Panel title="Supplier directory">
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'name', label: 'Supplier' },
              { key: 'vendor_code', label: 'Code' },
              { key: 'contact_person', label: 'Contact' },
              { key: 'phone', label: 'Phone' },
              { key: 'gstin', label: 'GSTIN' },
              {
                key: 'outstanding_paise',
                label: 'Outstanding',
                render: (r) => rupees(r.outstanding_paise),
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <Badge tone={r.status === 'ACTIVE' ? 'good' : 'bad'}>{r.status}</Badge>
                ),
              },
            ]}
            onRow={(r) => navigate('suppliers/' + r.id)}
          />
        )}
      </Panel>
      {adding && (
        <SupplierForm
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setRefresh(refresh + 1);
            navigate('suppliers/' + id);
          }}
        />
      )}
    </>
  );
}
function SupplierForm({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [v, setV] = useState<any>({
      name: '',
      vendor_code: '',
      contact_person: '',
      phone: '',
      gstin: '',
      billing_address: '',
      credit_period_days: 30,
    }),
    [error, setError] = useState('');
  const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return (
    <Modal title="Add supplier" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await post('/suppliers', {
              ...v,
              credit_period_days: Number(v.credit_period_days),
            });
            onDone(r.id);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          {[
            ['name', 'Supplier name'],
            ['vendor_code', 'Vendor code'],
            ['contact_person', 'Contact person'],
            ['phone', 'Phone'],
            ['gstin', 'GSTIN'],
            ['billing_address', 'Billing address'],
            ['credit_period_days', 'Credit period days'],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                required={k === 'name'}
                value={v[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save supplier</button>
        </div>
      </form>
    </Modal>
  );
}
export function SupplierDetail({ id, navigate }: { id: string; navigate: Nav }) {
  const { data: s, loading, error } = useData('/suppliers/' + id);
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">SUPPLIER RECORD</p>
          <h1>{s?.name}</h1>
          <p>
            {s?.contact_person} · {s?.phone} · {s?.gstin}
          </p>
        </div>
        <Badge tone={Number(s?.outstanding_paise) > 0 ? 'warn' : 'good'}>
          {rupees(s?.outstanding_paise)} outstanding
        </Badge>
      </div>
      <Panel title="Purchase history">
        <Table
          rows={s?.purchases || []}
          columns={[
            { key: 'purchase_number', label: 'Purchase' },
            { key: 'status', label: 'Status' },
            { key: 'total_paise', label: 'Total', render: (r) => rupees(r.total_paise) },
            { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
          ]}
          onRow={(r) => navigate('purchases/' + r.id)}
        />
      </Panel>
      <SupplierHistory data={s} />
    </>
  );
}
export function Purchases({ navigate }: { navigate: Nav }) {
  const [q, setQ] = useState(''),
    [adding, setAdding] = useState(false),
    [refresh, setRefresh] = useState(0),
    { data, loading } = useData('/purchases?q=' + encodeURIComponent(q), refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">INBOUND STOCK</p>
          <h1>Purchases</h1>
          <p>Orders, receiving and supplier balances.</p>
        </div>
        <button className="button primary" onClick={() => setAdding(true)}>
          ＋ New purchase
        </button>
      </div>
      <div className="filterbar">
        <input
          className="search-input"
          placeholder="Purchase number or supplier"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Panel title="Purchase register">
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'purchase_number', label: 'Purchase' },
              { key: 'supplier_name', label: 'Supplier' },
              { key: 'supplier_invoice_number', label: 'Supplier invoice' },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <Badge tone={r.status === 'RECEIVED' ? 'good' : 'warn'}>{r.status}</Badge>
                ),
              },
              { key: 'total_paise', label: 'Total', render: (r) => rupees(r.total_paise) },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
            onRow={(r) => navigate('purchases/' + r.id)}
          />
        )}
      </Panel>
      {adding && (
        <PurchaseForm
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setRefresh(refresh + 1);
            navigate('purchases/' + id);
          }}
        />
      )}
    </>
  );
}
function PurchaseForm({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const suppliers = useData('/suppliers'),
    parts = useData('/parts?limit=100');
  const [supplier, setSupplier] = useState(''),
    [invoice, setInvoice] = useState(''),
    [part, setPart] = useState(''),
    [qty, setQty] = useState(1),
    [rate, setRate] = useState(''),
    [lines, setLines] = useState<any[]>([]),
    [error, setError] = useState('');
  return (
    <Modal title="New purchase order" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await post('/purchases', {
              supplier_id: supplier,
              supplier_invoice_number: invoice,
              status: 'ORDERED',
              lines,
            });
            onDone(r.id);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Supplier">
            <select required value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Select supplier</option>
              {(suppliers.data || []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier invoice no.">
            <input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
        </div>
        <div className="subheading">Add items</div>
        <div className="purchase-line-form">
          <select
            value={part}
            onChange={(e) => {
              setPart(e.target.value);
              const p = (parts.data || []).find((x: any) => x.id === e.target.value);
              if (p) setRate(String(Number(p.selling_price_paise) / 100));
            }}
          >
            <option value="">Select part</option>
            {(parts.data || []).map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            placeholder="Qty"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Rate ₹"
          />
          <button
            type="button"
            className="button outline"
            onClick={() => {
              if (part && qty > 0) {
                setLines([
                  ...lines,
                  { part_id: part, quantity_ordered: qty, rate_paise: paise(rate) },
                ]);
                setPart('');
                setQty(1);
                setRate('');
              }
            }}
          >
            Add
          </button>
        </div>
        <Table
          rows={lines.map((l, i) => ({
            ...l,
            id: i,
            part_name: (parts.data || []).find((p: any) => p.id === l.part_id)?.name,
          }))}
          columns={[
            { key: 'part_name', label: 'Part' },
            { key: 'quantity_ordered', label: 'Qty' },
            { key: 'rate_paise', label: 'Rate', render: (r) => rupees(r.rate_paise) },
            {
              key: 'action',
              label: '',
              render: (r) => (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setLines(lines.filter((_, i) => i !== r.id))}
                >
                  Remove
                </button>
              ),
            },
          ]}
        />
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary" disabled={!lines.length}>
            Create order
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PurchaseDetail({ id, navigate }: { id: string; navigate: Nav }) {
  const [refresh, setRefresh] = useState(0),
    { data: p, loading, error } = useData('/purchases/' + id, refresh),
    [receiving, setReceiving] = useState(false),
    [paying, setPaying] = useState(false),
    [returning, setReturning] = useState(false);
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">PURCHASE ORDER</p>
          <h1>{p?.purchase_number}</h1>
          <p>
            {p?.supplier_name} · Supplier invoice {p?.supplier_invoice_number || '—'}
          </p>
        </div>
        <Badge tone={p?.status === 'RECEIVED' ? 'good' : 'warn'}>{p?.status}</Badge>
      </div>
      <div className="kpi-grid compact">
        <div className="kpi">
          <small>Order total</small>
          <strong>{rupees(p?.total_paise)}</strong>
        </div>
        <div className="kpi">
          <small>Paid</small>
          <strong>{rupees(p?.paid_paise)}</strong>
        </div>
        <div className="kpi">
          <small>Payment status</small>
          <strong>{p?.payment_status}</strong>
        </div>
      </div>
      <Panel title="Ordered parts">
        <Table
          rows={p?.lines || []}
          columns={[
            { key: 'part_name', label: 'Part' },
            { key: 'sku', label: 'SKU' },
            { key: 'quantity_ordered', label: 'Ordered' },
            { key: 'quantity_received', label: 'Received' },
            { key: 'free_quantity', label: 'Free' },
            { key: 'rate_paise', label: 'Rate', render: (r) => rupees(r.rate_paise) },
            {
              key: 'landed_unit_cost_paise',
              label: 'Landed cost',
              render: (r) => rupees(r.landed_unit_cost_paise),
            },
          ]}
        />
      </Panel>
      <Panel title="Actions">
        <div className="action-list">
          {['ORDERED', 'PARTIALLY_RECEIVED'].includes(p?.status) && (
            <button className="button primary" onClick={() => setReceiving(true)}>
              Receive goods
            </button>
          )}
          <button className="button outline" onClick={() => setPaying(true)}>
            Record supplier payment
          </button>
          {p?.status === 'RECEIVED' && (
            <button className="button outline" onClick={() => setReturning(true)}>
              Return to supplier
            </button>
          )}
        </div>
      </Panel>
      <PurchaseHistory data={p} />
      {receiving && (
        <ReceiveModal
          purchase={p}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {paying && (
        <PurchasePayment
          purchase={p}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {returning && (
        <PurchaseReturn
          purchase={p}
          onClose={() => setReturning(false)}
          onDone={() => {
            setReturning(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
    </>
  );
}
function ReceiveModal({
  purchase,
  onClose,
  onDone,
}: {
  purchase: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({}),
    [error, setError] = useState('');
  return (
    <Modal title="Receive goods" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const lines = Object.entries(quantities)
            .filter(([, q]) => q > 0)
            .map(([line_id, quantity]) => ({ line_id, quantity }));
          try {
            await post(`/purchases/${purchase.id}/receive`, { lines });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <Table
          rows={purchase.lines}
          columns={[
            { key: 'part_name', label: 'Part' },
            {
              key: 'remaining',
              label: 'Remaining',
              render: (r) => Number(r.quantity_ordered) - Number(r.quantity_received),
            },
            {
              key: 'receive',
              label: 'Receive now',
              render: (r) => (
                <input
                  className="cell-input qty"
                  type="number"
                  min="0"
                  max={Number(r.quantity_ordered) - Number(r.quantity_received)}
                  value={quantities[r.id] || 0}
                  onChange={(e) => setQuantities({ ...quantities, [r.id]: Number(e.target.value) })}
                />
              ),
            },
          ]}
        />
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Receive stock</button>
        </div>
      </form>
    </Modal>
  );
}
function PurchasePayment({
  purchase,
  onClose,
  onDone,
}: {
  purchase: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(''),
    [mode, setMode] = useState('BANK_TRANSFER'),
    [error, setError] = useState('');
  return (
    <Modal title="Supplier payment" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post(`/purchases/${purchase.id}/payments`, { amount_paise: paise(amount), mode });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Amount ₹">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {['BANK_TRANSFER', 'UPI', 'CASH', 'CARD'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Record payment</button>
        </div>
      </form>
    </Modal>
  );
}
function PurchaseReturn({
  purchase,
  onClose,
  onDone,
}: {
  purchase: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [part, setPart] = useState(''),
    [qty, setQty] = useState(1),
    [reason, setReason] = useState(''),
    [refund, setRefund] = useState('0'),
    [error, setError] = useState('');
  return (
    <Modal title="Return to supplier" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post(`/purchases/${purchase.id}/returns`, {
              part_id: part,
              quantity: qty,
              reason,
              refund_paise: paise(refund),
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
              {purchase.lines.map((l: any) => (
                <option key={l.id} value={l.part_id}>
                  {l.part_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </Field>
          <Field label="Cash refund received ₹">
            <input
              type="number"
              min="0"
              step="0.01"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
            />
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
          <button className="button primary">Record return</button>
        </div>
      </form>
    </Modal>
  );
}
