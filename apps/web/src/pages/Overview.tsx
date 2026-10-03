import React, { useState } from 'react';
import { api, patch, post, rupees, dateTime, financialYearStart, shopDate } from '../api';
import { Panel, Table, Loading, Message, useData, Badge, Field, Modal } from '../ui';
import type { Nav } from '../App';
export function Dashboard({ navigate, admin }: { navigate: Nav; admin: boolean }) {
  const { data, loading, error } = useData('/dashboard');
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">OPERATIONS OVERVIEW</p>
          <h1>Dashboard</h1>
          <p>Counter activity and stock position for today.</p>
        </div>
        <button className="button primary" onClick={() => navigate('billing')}>
          ＋ New invoice
        </button>
      </div>
      {admin && Number(data?.parts?.total) === 0 && (
        <Panel title="Finish first-run setup">
          <div className="setup-steps">
            <span>1. Check business and GST settings</span>
            <span>2. Add an employee in Settings</span>
            <span>3. Add parts and opening stock</span>
            <span>4. Register customers and trucks</span>
            <button className="button outline" onClick={() => navigate('parts')}>
              Add first part
            </button>
          </div>
        </Panel>
      )}
      <div className="kpi-grid">
        <Kpi
          label="Today's sales"
          value={rupees(data?.sales?.today_paise)}
          hint={`${data?.sales?.invoices || 0} invoices`}
        />
        <Kpi label="Parts sold" value={data?.sales?.parts_sold || 0} hint="Net units today" />
        <Kpi
          label="Low stock parts"
          value={data?.parts?.low || 0}
          hint="At or below minimum"
          onClick={() => navigate('stock')}
        />
        <Kpi
          label="Out of stock"
          value={data?.parts?.out_of_stock || 0}
          hint="Needs attention"
          onClick={() => navigate('stock')}
        />
        <Kpi
          label="Warranty pending"
          value={data?.claims?.pending || 0}
          hint="Open claims"
          onClick={() => navigate('warranty')}
        />
        {admin && (
          <>
            <Kpi
              label="Today's purchases"
              value={rupees(data?.purchases?.today_paise)}
              hint="Goods received"
            />
            <Kpi
              label="Customer outstanding"
              value={rupees(data?.finance?.receivable_paise)}
              hint="Receivables"
            />
            <Kpi
              label="Supplier outstanding"
              value={rupees(data?.finance?.payable_paise)}
              hint="Payables"
            />
            <Kpi
              label="Inventory value"
              value={rupees(data?.parts?.stock_value_paise)}
              hint="At purchase cost"
            />
          </>
        )}
      </div>
      <div className="two-col">
        <Panel title="Low stock / reorder">
          <Table
            rows={data?.lowStock || []}
            columns={[
              { key: 'name', label: 'Part' },
              { key: 'sku', label: 'SKU' },
              {
                key: 'available',
                label: 'Available',
                render: (r) => (
                  <Badge tone="warn">{Number(r.current_stock) - Number(r.reserved_stock)}</Badge>
                ),
              },
              { key: 'min_stock', label: 'Minimum' },
              { key: 'reorder_quantity', label: 'Reorder' },
            ]}
            onRow={(r) => navigate('parts/' + r.id)}
            empty="Stock levels are healthy."
          />
        </Panel>
        <Panel title="Recent invoices">
          <Table
            rows={data?.recentInvoices || []}
            columns={[
              { key: 'invoice_number', label: 'Invoice' },
              {
                key: 'customer_name',
                label: 'Customer',
                render: (r) => r.customer_name || 'Walk-in',
              },
              { key: 'total_paise', label: 'Total', render: (r) => rupees(r.total_paise) },
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            ]}
            onRow={(r) => navigate('invoices/' + r.id)}
            empty="No invoices yet."
          />
        </Panel>
      </div>
    </>
  );
}
function Kpi({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: any;
  hint: string;
  onClick?: () => void;
}) {
  return (
    <div className={'kpi ' + (onClick ? 'clickable' : '')} onClick={onClick}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{hint}</span>
    </div>
  );
}
export function Reports() {
  const [from, setFrom] = useState(financialYearStart),
    [to, setTo] = useState(shopDate),
    [deadDays, setDeadDays] = useState(90);
  const sales = useData(`/reports/sales?from=${from}&to=${to}`),
    stock = useData(`/reports/stock?deadDays=${deadDays}`),
    top = useData('/reports/top-parts'),
    finance = useData(`/reports/finance?from=${from}&to=${to}`),
    margins = useData(`/reports/margins?from=${from}&to=${to}`);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">BUSINESS INTELLIGENCE</p>
          <h1>Reports</h1>
          <p>Figures come from completed transactions and the stock ledger.</p>
        </div>
      </div>
      <div className="filterbar">
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Dead stock age">
          <select value={deadDays} onChange={(e) => setDeadDays(Number(e.target.value))}>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </Field>
      </div>
      <Panel title="Sales by day">
        {sales.loading ? (
          <Loading />
        ) : (
          <Table
            rows={sales.data || []}
            columns={[
              { key: 'day', label: 'Date' },
              { key: 'invoice_count', label: 'Invoices' },
              { key: 'sales_paise', label: 'Sales', render: (r) => rupees(r.sales_paise) },
              { key: 'taxable_paise', label: 'Taxable', render: (r) => rupees(r.taxable_paise) },
              { key: 'cgst_paise', label: 'CGST', render: (r) => rupees(r.cgst_paise) },
              { key: 'sgst_paise', label: 'SGST', render: (r) => rupees(r.sgst_paise) },
              { key: 'igst_paise', label: 'IGST', render: (r) => rupees(r.igst_paise) },
            ]}
          />
        )}
      </Panel>
      <div className="kpi-grid compact">
        <Kpi label="Net sales" value={rupees(finance.data?.sales_paise)} hint="Selected period" />
        <Kpi
          label="Goods received"
          value={rupees(finance.data?.purchases_paise)}
          hint="Selected period"
        />
        <Kpi label="Expenses" value={rupees(finance.data?.expenses_paise)} hint="Selected period" />
      </div>
      <div className="two-col">
        <Panel title="Customer receivables">
          <Table
            rows={finance.data?.receivables || []}
            columns={[
              { key: 'name', label: 'Customer' },
              {
                key: 'outstanding_paise',
                label: 'Outstanding',
                render: (r) => rupees(r.outstanding_paise),
              },
            ]}
          />
        </Panel>
        <Panel title="Supplier payables & credits">
          <Table
            rows={finance.data?.payables || []}
            columns={[
              { key: 'name', label: 'Supplier' },
              {
                key: 'outstanding_paise',
                label: 'Payable',
                render: (r) => rupees(r.outstanding_paise),
              },
              {
                key: 'credit_balance_paise',
                label: 'Credit',
                render: (r) => rupees(r.credit_balance_paise),
              },
            ]}
          />
        </Panel>
      </div>
      <div className="two-col">
        <Panel title="Fast moving parts · 90 days">
          {top.loading ? (
            <Loading />
          ) : (
            <Table
              rows={top.data || []}
              columns={[
                { key: 'name', label: 'Part' },
                { key: 'sku', label: 'SKU' },
                { key: 'quantity_sold', label: 'Qty sold' },
                { key: 'net_paise', label: 'Net sales', render: (r) => rupees(r.net_paise) },
              ]}
            />
          )}
        </Panel>
        <Panel title={`No sale in ${deadDays} days`}>
          {stock.loading ? (
            <Loading />
          ) : (
            <Table
              rows={stock.data || []}
              columns={[
                { key: 'name', label: 'Part' },
                { key: 'current_stock', label: 'Stock' },
                { key: 'value_paise', label: 'Value', render: (r) => rupees(r.value_paise) },
              ]}
            />
          )}
        </Panel>
      </div>
      <Panel title="Part gross margin · before operating expenses">
        {margins.loading ? (
          <Loading />
        ) : (
          <Table
            rows={margins.data || []}
            columns={[
              { key: 'name', label: 'Part' },
              { key: 'sku', label: 'SKU' },
              {
                key: 'taxable_paise',
                label: 'Net taxable sales',
                render: (r) => rupees(r.taxable_paise),
              },
              { key: 'cogs_paise', label: 'Cost of goods', render: (r) => rupees(r.cogs_paise) },
              { key: 'margin_paise', label: 'Gross margin', render: (r) => rupees(r.margin_paise) },
              {
                key: 'margin_bps',
                label: 'Margin %',
                render: (r) => `${(Number(r.margin_bps) / 100).toFixed(1)}%`,
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
export function Settings({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const { data, loading, error, setData } = useData('/settings'),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState(''),
    [addingUser, setAddingUser] = useState(false),
    [refresh, setRefresh] = useState(0);
  const users = useData('/auth/users', refresh),
    audit = useData('/audit');
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  const values: any = data || {};
  const set = (key: string, value: any) => setData({ ...values, [key]: value });
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Settings</h1>
          <p>Business identity, tax and invoice defaults.</p>
        </div>
      </div>
      <Panel title="Business details">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setMessage('');
            try {
              const updated = await patch('/settings', values);
              setData(updated);
              setMessage('Settings saved.');
            } catch (e: any) {
              setMessage(e.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="form-grid">
            {[
              ['name', 'Shop name'],
              ['address', 'Address'],
              ['phone', 'Phone'],
              ['email', 'Email'],
              ['gstin', 'GSTIN'],
              ['state', 'State'],
              ['invoice_prefix', 'Invoice prefix'],
              ['invoice_footer', 'Invoice footer'],
              ['terms', 'Terms & conditions'],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input value={values[key] || ''} onChange={(e) => set(key, e.target.value)} />
              </Field>
            ))}
            <Field label="Default GST (%)">
              <input
                type="number"
                value={Number(values.default_gst_bps || 0) / 100}
                onChange={(e) => set('default_gst_bps', Math.round(Number(e.target.value) * 100))}
              />
            </Field>
            <Field label="Paper format">
              <select
                value={values.paper_format || 'A4'}
                onChange={(e) => set('paper_format', e.target.value)}
              >
                <option>A4</option>
                <option>COMPACT</option>
              </select>
            </Field>
          </div>
          <Message type={message === 'Settings saved.' ? 'success' : 'error'}>{message}</Message>
          <div className="form-actions">
            <button className="button primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </Panel>
      <PasswordForm onDone={onPasswordChanged} />
      <Panel
        title="Staff accounts"
        action={
          <button className="button outline" onClick={() => setAddingUser(true)}>
            ＋ Add employee
          </button>
        }
      >
        <Table
          rows={users.data || []}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role' },
            {
              key: 'active',
              label: 'Status',
              render: (r) => (
                <Badge tone={r.active ? 'good' : 'bad'}>{r.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title="Recent audit history">
        <Table
          rows={(audit.data || []).slice(0, 30)}
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            { key: 'actor_name', label: 'User' },
            { key: 'action', label: 'Action' },
            { key: 'entity_type', label: 'Record' },
            { key: 'entity_id', label: 'ID' },
          ]}
        />
      </Panel>
      {addingUser && (
        <NewUser
          onClose={() => setAddingUser(false)}
          onDone={() => {
            setAddingUser(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
    </>
  );
}
function PasswordForm({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Panel title="Change my password">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (newPassword !== confirmation) {
            setError('New passwords do not match.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await post('/auth/change-password', { currentPassword, newPassword });
            onDone();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button outline" disabled={busy}>
            {busy ? 'Changing…' : 'Change password and sign out'}
          </button>
        </div>
      </form>
    </Panel>
  );
}
function NewUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState('EMPLOYEE'),
    [error, setError] = useState('');
  return (
    <Modal title="Add staff account" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/auth/users', { name, email, password, role });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Name">
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Temporary password">
            <input
              type="password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="EMPLOYEE">Counter operator</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Create account</button>
        </div>
      </form>
    </Modal>
  );
}
