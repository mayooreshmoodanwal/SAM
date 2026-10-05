import React, { useState } from 'react';
import { api, patch, post, rupees, paise, dateTime, shopDate } from '../api';
import { Panel, Table, Modal, Field, Message, Loading, Badge, useData } from '../ui';
import { ScanControl } from '../scanning/ScanControl';
import type { Nav } from '../App';
export function Warranty({ navigate, admin }: { navigate: Nav; admin: boolean }) {
  const [q, setQ] = useState(''),
    [selected, setSelected] = useState<any>(null),
    [refresh, setRefresh] = useState(0),
    [scanInvoices, setScanInvoices] = useState<any[] | null>(null),
    { data, loading } = useData('/warranty?q=' + encodeURIComponent(q), refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">AFTER-SALES SUPPORT</p>
          <h1>Warranty</h1>
          <p>Claims linked to the original invoice, part and truck.</p>
        </div>
      </div>
      <ScanControl
        context="WARRANTY"
        enabled={!selected}
        onResult={async (result) => {
          const invoices = await api('/parts/' + result.product.id + '/warranty-invoices');
          setScanInvoices(invoices);
          return `${result.product.name} identified. Select the original invoice to open a claim.`;
        }}
      />
      {scanInvoices && (
        <Panel title="Select original invoice for warranty">
          <Table
            rows={scanInvoices}
            columns={[
              { key: 'invoice_number', label: 'Invoice' },
              { key: 'part_name', label: 'Part' },
              { key: 'customer_name', label: 'Customer' },
              { key: 'registration_number', label: 'Vehicle' },
              { key: 'created_at', label: 'Sold', render: (r) => dateTime(r.created_at) },
            ]}
            onRow={(r) => navigate('invoices/' + r.invoice_id)}
            empty="No invoice with product warranty was found. Search the original invoice manually."
          />
        </Panel>
      )}
      <div className="filterbar">
        <input
          className="search-input"
          placeholder="Claim, invoice or registration"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Panel title="Claim register">
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'claim_number', label: 'Claim' },
              { key: 'part_name', label: 'Part' },
              { key: 'customer_name', label: 'Customer' },
              { key: 'registration_number', label: 'Vehicle' },
              { key: 'invoice_number', label: 'Invoice' },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <Badge tone={r.status === 'COMPLETED' ? 'good' : 'warn'}>{r.status}</Badge>
                ),
              },
              { key: 'warranty_end', label: 'Warranty ends' },
              { key: 'created_at', label: 'Opened', render: (r) => dateTime(r.created_at) },
            ]}
            onRow={admin ? setSelected : undefined}
            empty="No warranty claims yet. Open a claim from an invoice line."
          />
        )}
      </Panel>
      {selected && (
        <Modal title={selected.claim_number} onClose={() => setSelected(null)}>
          <p>
            <b>{selected.part_name}</b> · {selected.complaint}
          </p>
          <p className="muted">
            Invoice {selected.invoice_number} ·{' '}
            {selected.registration_number || selected.customer_name}
          </p>
          <WarrantyStatus
            claim={selected}
            onDone={() => {
              setSelected(null);
              setRefresh(refresh + 1);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function WarrantyStatus({ claim, onDone }: { claim: any; onDone: () => void }) {
  const [status, setStatus] = useState(claim.status),
    [remarks, setRemarks] = useState(claim.remarks || ''),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await patch('/warranty/' + claim.id, { status, remarks });
          onDone();
        } catch (e: any) {
          setError(e.message);
        }
      }}
    >
      <div className="form-grid">
        <Field label="Claim status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {[
              'DRAFT',
              'SUBMITTED',
              'UNDER_REVIEW',
              'APPROVED',
              'REJECTED',
              'REPLACEMENT_ORDERED',
              'REPLACEMENT_RECEIVED',
              'COMPLETED',
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Remarks">
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
      <Message>{error}</Message>
      <div className="form-actions">
        <button className="button primary">Update claim</button>
      </div>
    </form>
  );
}
export function Expenses() {
  const [adding, setAdding] = useState(false),
    [refresh, setRefresh] = useState(0),
    { data, loading } = useData('/expenses', refresh);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">OPERATING COSTS</p>
          <h1>Expenses</h1>
          <p>Shop and transport costs with payment references.</p>
        </div>
        <button className="button primary" onClick={() => setAdding(true)}>
          ＋ Add expense
        </button>
      </div>
      <Panel title="Expense register">
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data || []}
            columns={[
              { key: 'expense_date', label: 'Date' },
              { key: 'category', label: 'Category' },
              { key: 'description', label: 'Description' },
              { key: 'vendor', label: 'Vendor' },
              { key: 'amount_paise', label: 'Amount', render: (r) => rupees(r.amount_paise) },
              { key: 'payment_mode', label: 'Payment' },
              { key: 'added_by', label: 'Added by' },
            ]}
            empty="No expenses recorded yet."
          />
        )}
      </Panel>
      {adding && (
        <ExpenseForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
    </>
  );
}
function ExpenseForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({
      expense_date: shopDate(),
      category: 'Shop Expense',
      description: '',
      amount: '',
      payment_mode: 'CASH',
      vendor: '',
      reference: '',
    }),
    [error, setError] = useState('');
  const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return (
    <Modal title="Add expense" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/expenses', {
              expense_date: v.expense_date,
              category: v.category,
              description: v.description,
              amount_paise: paise(v.amount),
              payment_mode: v.payment_mode,
              vendor: v.vendor || null,
              reference: v.reference || null,
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Date">
            <input
              type="date"
              value={v.expense_date}
              onChange={(e) => set('expense_date', e.target.value)}
            />
          </Field>
          <Field label="Category">
            <select value={v.category} onChange={(e) => set('category', e.target.value)}>
              {[
                'Rent',
                'Electricity',
                'Salary',
                'Transport',
                'Freight',
                'Shop Expense',
                'Maintenance',
                'Internet',
                'Fuel',
                'Miscellaneous',
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <input
              required
              value={v.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <Field label="Amount ₹">
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={v.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
          </Field>
          <Field label="Payment mode">
            <select value={v.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>
              {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Vendor">
            <input value={v.vendor} onChange={(e) => set('vendor', e.target.value)} />
          </Field>
          <Field label="Reference">
            <input value={v.reference} onChange={(e) => set('reference', e.target.value)} />
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save expense</button>
        </div>
      </form>
    </Modal>
  );
}
