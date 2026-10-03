import React, { useEffect, useRef, useState } from 'react';
import { api, post, rupees, paise, dateTime } from '../api';
import { Panel, Table, Modal, Field, Message, Loading, Badge, useData } from '../ui';
import type { Nav } from '../App';

type CartLine = { part: any; quantity: number; discount: string };
export function Billing({
  navigate,
  admin,
  initialPartId,
}: {
  navigate: Nav;
  admin: boolean;
  initialPartId?: string;
}) {
  const [search, setSearch] = useState(''),
    [results, setResults] = useState<any[]>([]),
    [highlight, setHighlight] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]),
    [customerId, setCustomerId] = useState(''),
    [vehicleId, setVehicleId] = useState('');
  const [customerQ, setCustomerQ] = useState(''),
    [customers, setCustomers] = useState<any[]>([]),
    [vehicles, setVehicles] = useState<any[]>([]);
  const [paymentMode, setPaymentMode] = useState('CASH'),
    [paymentAmount, setPaymentAmount] = useState(''),
    [payments, setPayments] = useState<{ mode: string; amount_paise: number }[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState('0'),
    [remarks, setRemarks] = useState(''),
    [quote, setQuote] = useState<any>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [showCustomer, setShowCustomer] = useState(false),
    [showPayment, setShowPayment] = useState(false),
    [creditOverride, setCreditOverride] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null),
    initialHandled = useRef('');
  useEffect(() => {
    if (!initialPartId || initialHandled.current === initialPartId) return;
    initialHandled.current = initialPartId;
    const [partId, query] = initialPartId.split('?');
    const params = new URLSearchParams(query || '');
    if (params.get('customer')) setCustomerId(params.get('customer')!);
    if (params.get('vehicle')) setVehicleId(params.get('vehicle')!);
    api('/parts/' + partId)
      .then((part) => addPart(part))
      .catch(() => {});
  }, [initialPartId]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim())
        api('/parts?q=' + encodeURIComponent(search) + '&activeOnly=true&limit=12')
          .then(setResults)
          .catch(() => setResults([]));
      else setResults([]);
    }, 120);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    api('/customers?q=' + encodeURIComponent(customerQ))
      .then((rows) =>
        setCustomers((current) => {
          const selected = current.find((c) => c.id === customerId);
          return selected && !rows.some((c: any) => c.id === selected.id)
            ? [selected, ...rows]
            : rows;
        }),
      )
      .catch(() => {});
  }, [customerQ, customerId]);
  useEffect(() => {
    if (customerId)
      api('/customers/' + customerId).then((c) => {
        setVehicles(c.vehicles || []);
        setCustomers((current) => (current.some((x) => x.id === c.id) ? current : [c, ...current]));
      });
    else setVehicles([]);
  }, [customerId]);
  useEffect(() => {
    if (!cart.length) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(
      () =>
        post('/sales/quote', {
          lines: cart.map((l) => ({
            part_id: l.part.id,
            quantity: l.quantity,
            discount_paise: paise(l.discount),
          })),
          invoice_discount_paise: paise(invoiceDiscount),
          payments: [],
        })
          .then(setQuote)
          .catch((e) => setMessage(e.message)),
      150,
    );
    return () => clearTimeout(timer);
  }, [cart, invoiceDiscount]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        document.getElementById('customer-select')?.focus();
      }
      if (e.key === 'F6') {
        e.preventDefault();
        setShowPayment(true);
      }
      if (e.key === 'F8') {
        e.preventDefault();
        document.getElementById('save-invoice')?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  function addPart(part: any) {
    setMessage('');
    setCart((current) => {
      const found = current.find((l) => l.part.id === part.id);
      if (found) {
        if (
          found.quantity + 1 >
          Number(part.available_stock ?? part.current_stock - part.reserved_stock)
        ) {
          setMessage(`Only ${part.available_stock} units available.`);
          return current;
        }
        return current.map((l) => (l.part.id === part.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (Number(part.available_stock ?? part.current_stock - part.reserved_stock) < 1) {
        setMessage('This part is out of stock.');
        return current;
      }
      return [...current, { part, quantity: 1, discount: '0' }];
    });
    setSearch('');
    setResults([]);
    setHighlight(0);
    inputRef.current?.focus();
  }
  const paid = payments.reduce((n, p) => n + p.amount_paise, 0),
    due = Math.max(0, Number(quote?.totals?.totalPaise || 0) - paid);
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const creditExcess = selectedCustomer
    ? Math.max(
        0,
        Number(selectedCustomer.outstanding_paise) +
          due -
          Number(selectedCustomer.credit_limit_paise),
      )
    : 0;
  async function save() {
    if (!cart.length) return setMessage('Add at least one part.');
    setBusy(true);
    setMessage('');
    try {
      const invoice = await post('/sales/invoices', {
        customer_id: customerId || null,
        vehicle_id: vehicleId || null,
        lines: cart.map((l) => ({
          part_id: l.part.id,
          quantity: l.quantity,
          discount_paise: paise(l.discount),
        })),
        invoice_discount_paise: paise(invoiceDiscount),
        payments,
        credit_override: admin && creditOverride,
        remarks,
      });
      navigate('invoices/' + invoice.id);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title billing-title">
        <div>
          <p className="eyebrow">COUNTER · NEW SALE</p>
          <h1>Billing</h1>
          <p>Search a part, select a truck, take payment and save.</p>
        </div>
        <div className="shortcut-bar">
          <span>F2 Search</span>
          <span>F4 Customer</span>
          <span>F6 Payment</span>
          <span>F8 Save</span>
        </div>
      </div>
      <div className="billing-layout">
        <div className="billing-main">
          <Panel title="Find a part">
            <div className="part-search">
              <input
                ref={inputRef}
                autoFocus
                placeholder="Part name, OEM, SKU or scan barcode…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlight(Math.min(results.length - 1, highlight + 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlight(Math.max(0, highlight - 1));
                  }
                  if (e.key === 'Enter' && results[highlight]) {
                    e.preventDefault();
                    addPart(results[highlight]);
                  }
                }}
              />
              <span>⌕</span>
            </div>
            {search && (
              <div className="part-results">
                <div className="result-head">
                  <span>PART / OEM</span>
                  <span>BRAND</span>
                  <span>PRICE</span>
                  <span>AVAILABLE</span>
                  <span>LOCATION</span>
                </div>
                {results.map((p, i) => (
                  <button
                    key={p.id}
                    className={i === highlight ? 'selected' : ''}
                    onClick={() => addPart(p)}
                  >
                    <span>
                      <b>{p.name}</b>
                      <small>{p.oem_number || p.sku}</small>
                    </span>
                    <span>{p.brand}</span>
                    <span>{rupees(p.selling_price_paise)}</span>
                    <span className={Number(p.available_stock) <= 0 ? 'text-danger' : ''}>
                      {p.available_stock}
                    </span>
                    <span>
                      {p.rack || '—'} {p.bin || ''}
                    </span>
                  </button>
                ))}
                {!results.length && <div className="empty-cell">No matching parts.</div>}
              </div>
            )}
          </Panel>
          <Panel title={`Invoice items · ${cart.length}`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part / OEM</th>
                    <th>Qty</th>
                    <th>MRP</th>
                    <th>Rate</th>
                    <th>Disc. ₹</th>
                    <th>Taxable</th>
                    <th>GST</th>
                    <th>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.length ? (
                    cart.map((l, i) => (
                      <tr key={l.part.id}>
                        <td>
                          <b>{l.part.name}</b>
                          <br />
                          <small>
                            {l.part.oem_number || l.part.sku} · Avl {l.part.available_stock}
                          </small>
                        </td>
                        <td>
                          <input
                            className="cell-input qty"
                            type="number"
                            min="1"
                            max={l.part.available_stock}
                            value={l.quantity}
                            onChange={(e) =>
                              setCart(
                                cart.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        quantity: Math.max(
                                          1,
                                          Math.min(
                                            Number(l.part.available_stock),
                                            Number(e.target.value) || 1,
                                          ),
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>{rupees(l.part.mrp_paise)}</td>
                        <td>{rupees(l.part.selling_price_paise)}</td>
                        <td>
                          <input
                            className="cell-input money"
                            type="number"
                            min="0"
                            value={l.discount}
                            onChange={(e) =>
                              setCart(
                                cart.map((x, j) =>
                                  j === i ? { ...x, discount: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          {rupees(
                            quote?.lines?.find((x: any) => x.part_id === l.part.id)?.taxablePaise,
                          )}
                        </td>
                        <td>
                          {rupees(
                            quote?.lines?.find((x: any) => x.part_id === l.part.id)?.gstPaise,
                          )}
                        </td>
                        <td>
                          <b>
                            {rupees(
                              quote?.lines?.find((x: any) => x.part_id === l.part.id)?.totalPaise,
                            )}
                          </b>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            onClick={() => setCart(cart.filter((_, j) => j !== i))}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="cart-empty">
                        <strong>Ready for the next sale</strong>
                        <p>Search by name, OEM number or scan a barcode above.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="billing-side">
          <Panel title="Customer & vehicle">
            <Field label="Find customer">
              <input
                placeholder="Name or phone"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
              />
            </Field>
            <Field label="Customer">
              <select
                id="customer-select"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setVehicleId('');
                  setCreditOverride(false);
                }}
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? '· ' + c.phone : ''}
                  </option>
                ))}
              </select>
            </Field>
            <button className="link-button" onClick={() => setShowCustomer(true)}>
              ＋ Add customer
            </button>
            <Field label="Vehicle / truck">
              <select
                value={vehicleId}
                disabled={!customerId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">No vehicle selected</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration_number || v.chassis_number} · {v.model || 'Truck'}
                  </option>
                ))}
              </select>
            </Field>
            {customerId && (
              <button className="link-button" onClick={() => navigate('customers/' + customerId)}>
                View customer history ↗
              </button>
            )}
          </Panel>
          <Panel title="Payment & totals">
            <div className="totals-list">
              <div>
                <span>Subtotal</span>
                <b>{rupees(quote?.totals?.subtotalPaise)}</b>
              </div>
              <div>
                <span>Line discounts</span>
                <b>− {rupees(cart.reduce((n, l) => n + paise(l.discount), 0))}</b>
              </div>
              <div>
                <span>Invoice discount</span>
                <input
                  type="number"
                  min="0"
                  value={invoiceDiscount}
                  onChange={(e) => setInvoiceDiscount(e.target.value)}
                />
              </div>
              <div>
                <span>Taxable</span>
                <b>{rupees(quote?.totals?.taxablePaise)}</b>
              </div>
              <div>
                <span>CGST + SGST</span>
                <b>
                  {rupees(
                    Number(quote?.totals?.cgstPaise || 0) + Number(quote?.totals?.sgstPaise || 0),
                  )}
                </b>
              </div>
              <div className="grand-total">
                <span>Grand total</span>
                <strong>{rupees(quote?.totals?.totalPaise)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <b>{rupees(paid)}</b>
              </div>
              <div className={due ? 'pending' : ''}>
                <span>Pending</span>
                <b>{rupees(due)}</b>
              </div>
            </div>
            <button className="button outline wide" onClick={() => setShowPayment(true)}>
              ＋ Add payment
            </button>
            {payments.map((p, i) => (
              <div className="payment-chip" key={i}>
                {p.mode} · {rupees(p.amount_paise)}{' '}
                <button onClick={() => setPayments(payments.filter((_, j) => i !== j))}>×</button>
              </div>
            ))}
            {due > 0 && !customerId && (
              <Message type="info">Select a customer for a credit balance.</Message>
            )}
            {due > 0 && creditExcess > 0 && (
              <Message type="info">Credit limit exceeded by {rupees(creditExcess)}.</Message>
            )}
            {admin && creditExcess > 0 && (
              <label className="override-check">
                <input
                  type="checkbox"
                  checked={creditOverride}
                  onChange={(e) => setCreditOverride(e.target.checked)}
                />
                Approve credit override
              </label>
            )}
            <Field label="Remarks">
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
            </Field>
            <Message>{message}</Message>
            <button
              id="save-invoice"
              className="button primary wide save-button"
              disabled={busy || !cart.length}
              onClick={save}
            >
              {busy ? 'Saving invoice…' : 'Save invoice  F8'}
            </button>
          </Panel>
        </div>
      </div>
      {showCustomer && (
        <NewCustomer
          onClose={() => setShowCustomer(false)}
          onCreated={(c) => {
            setCustomerId(c.id);
            setCreditOverride(false);
            setShowCustomer(false);
            setCustomerQ(c.name);
          }}
        />
      )}
      {showPayment && (
        <Modal title="Add payment" onClose={() => setShowPayment(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const amount = paise(paymentAmount);
              if (amount <= 0 || amount > due) {
                setMessage('Payment must be greater than zero and within the pending amount.');
                return;
              }
              setPayments([...payments, { mode: paymentMode, amount_paise: amount }]);
              setPaymentAmount('');
              setShowPayment(false);
            }}
          >
            <div className="form-grid">
              <Field label="Mode">
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                  {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Amount ₹">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={due / 100}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  autoFocus
                />
              </Field>
            </div>
            <p className="muted">Remaining to collect: {rupees(due)}</p>
            <div className="form-actions">
              <button className="button primary">Add payment</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function NewCustomer({ onClose, onCreated }: { onClose: () => void; onCreated: (c: any) => void }) {
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="New customer" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onCreated(
              await post('/customers', {
                name,
                phone,
                type: 'INDIVIDUAL',
                credit_limit_paise: 0,
                credit_period_days: 0,
              }),
            );
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Customer name">
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Create customer</button>
        </div>
      </form>
    </Modal>
  );
}
export function InvoiceDetail({
  id,
  navigate,
  admin,
}: {
  id: string;
  navigate: Nav;
  admin: boolean;
}) {
  const [refresh, setRefresh] = useState(0),
    { data, loading, error } = useData('/sales/invoices/' + id, refresh),
    [payment, setPayment] = useState(false),
    [returning, setReturning] = useState(false),
    [refund, setRefund] = useState<any>(null),
    [warrantyLine, setWarrantyLine] = useState<any>(null),
    [message, setMessage] = useState('');
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault();
        window.open('/api/sales/invoices/' + id + '/pdf', '_blank');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [id]);
  if (loading) return <Loading />;
  if (error) return <Message>{error}</Message>;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">SALES INVOICE</p>
          <h1>{data?.invoice_number}</h1>
          <p>
            {dateTime(data?.created_at)} · {data?.customer_name || 'Walk-in customer'} ·{' '}
            {data?.registration_number || 'No vehicle'}
          </p>
        </div>
        <div className="title-actions">
          <Badge tone={data?.status === 'COMPLETED' ? 'good' : 'bad'}>{data?.status}</Badge>
          <a className="button outline" href={'/api/sales/invoices/' + id + '/pdf'} target="_blank">
            Print / PDF
          </a>
        </div>
      </div>
      <div className="kpi-grid compact">
        <div className="kpi">
          <small>Grand total</small>
          <strong>{rupees(data?.total_paise)}</strong>
        </div>
        <div className="kpi">
          <small>Paid</small>
          <strong>{rupees(data?.paid_paise)}</strong>
        </div>
        <div className="kpi">
          <small>Pending</small>
          <strong>{rupees(data?.pending_paise)}</strong>
        </div>
      </div>
      <Panel title="Invoice items">
        <Table
          rows={data?.lines || []}
          columns={[
            { key: 'part_name', label: 'Part' },
            { key: 'oem_number', label: 'OEM' },
            { key: 'quantity', label: 'Qty' },
            { key: 'rate_paise', label: 'Rate', render: (r) => rupees(r.rate_paise) },
            { key: 'taxable_paise', label: 'Taxable', render: (r) => rupees(r.taxable_paise) },
            { key: 'gst_paise', label: 'GST', render: (r) => rupees(r.gst_paise) },
            { key: 'total_paise', label: 'Total', render: (r) => rupees(r.total_paise) },
            {
              key: 'warranty',
              label: 'Warranty',
              render: (r) =>
                r.warranty_months ? (
                  <button className="link-button" onClick={() => setWarrantyLine(r)}>
                    Claim
                  </button>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Panel>
      <div className="two-col">
        <Panel title="Payments">
          <Table
            rows={data?.payments || []}
            columns={[
              { key: 'mode', label: 'Mode' },
              { key: 'amount_paise', label: 'Amount', render: (r) => rupees(r.amount_paise) },
              { key: 'paid_at', label: 'Date', render: (r) => dateTime(r.paid_at) },
            ]}
          />
          {Number(data?.pending_paise) > 0 && (
            <button className="button outline" onClick={() => setPayment(true)}>
              Record payment
            </button>
          )}
        </Panel>
        <Panel title="Actions & history">
          <div className="action-list">
            <button
              className="button outline"
              disabled={data?.status !== 'COMPLETED'}
              onClick={() => setReturning(true)}
            >
              Create sales return
            </button>
            {admin && data?.status === 'COMPLETED' && Number(data.paid_paise) === 0 && (
              <button
                className="button danger"
                onClick={async () => {
                  const reason = prompt('Reason for cancellation');
                  if (!reason) return;
                  try {
                    await post('/sales/invoices/' + id + '/cancel', { reason });
                    setRefresh(refresh + 1);
                  } catch (e: any) {
                    setMessage(e.message);
                  }
                }}
              >
                Cancel invoice
              </button>
            )}
          </div>
          <Message>{message}</Message>
          <p className="muted">Returns and cancellations create corrective stock ledger entries.</p>
        </Panel>
      </div>
      {!!data?.returns?.length && (
        <Panel title="Sales returns & refunds">
          <Table
            rows={data.returns}
            columns={[
              { key: 'created_at', label: 'Returned', render: (r) => dateTime(r.created_at) },
              { key: 'reason', label: 'Reason' },
              { key: 'refund_paise', label: 'Refund due', render: (r) => rupees(r.refund_paise) },
              { key: 'refunded_paise', label: 'Refunded', render: (r) => rupees(r.refunded_paise) },
              {
                key: 'action',
                label: '',
                render: (r) =>
                  admin && Number(r.refund_paise) > Number(r.refunded_paise) ? (
                    <button className="button small outline" onClick={() => setRefund(r)}>
                      Record refund
                    </button>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </Panel>
      )}
      {payment && (
        <PaymentModal
          id={id}
          pending={Number(data.pending_paise)}
          onClose={() => setPayment(false)}
          onDone={() => {
            setPayment(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {returning && (
        <ReturnModal
          data={data}
          onClose={() => setReturning(false)}
          onDone={() => {
            setReturning(false);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {refund && (
        <RefundModal
          item={refund}
          onClose={() => setRefund(null)}
          onDone={() => {
            setRefund(null);
            setRefresh(refresh + 1);
          }}
        />
      )}
      {warrantyLine && (
        <WarrantyModal
          line={warrantyLine}
          onClose={() => setWarrantyLine(null)}
          onDone={() => {
            setWarrantyLine(null);
            navigate('warranty');
          }}
        />
      )}
    </>
  );
}
function PaymentModal({
  id,
  pending,
  onClose,
  onDone,
}: {
  id: string;
  pending: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState('CASH'),
    [amount, setAmount] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Record payment" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post(`/sales/invoices/${id}/payments`, { mode, amount_paise: paise(amount) });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label={`Amount ₹ · pending ${rupees(pending)}`}>
            <input
              type="number"
              step="0.01"
              max={pending / 100}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
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
function ReturnModal({
  data,
  onClose,
  onDone,
}: {
  data: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [line, setLine] = useState(data.lines[0]?.id || ''),
    [qty, setQty] = useState(1),
    [condition, setCondition] = useState('GOOD'),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Sales return" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post(`/sales/invoices/${data.id}/returns`, {
              reason,
              lines: [{ invoice_line_id: line, quantity: qty, condition }],
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Part">
            <select value={line} onChange={(e) => setLine(e.target.value)}>
              {data.lines.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.part_name} · {Number(l.quantity) - Number(l.returned_quantity)} left
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
          <Field label="Condition">
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {['GOOD', 'DAMAGED', 'DEFECTIVE', 'WARRANTY'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
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
          <button className="button primary">Create return</button>
        </div>
      </form>
    </Modal>
  );
}
function WarrantyModal({
  line,
  onClose,
  onDone,
}: {
  line: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [complaint, setComplaint] = useState(''),
    [serial, setSerial] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title={`Warranty claim · ${line.part_name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/warranty', { invoice_line_id: line.id, complaint, serial_number: serial });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <Field label="Complaint">
          <textarea
            required
            minLength={5}
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
          />
        </Field>
        <Field label="Serial number">
          <input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </Field>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Open claim</button>
        </div>
      </form>
    </Modal>
  );
}
function RefundModal({
  item,
  onClose,
  onDone,
}: {
  item: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(
      String((Number(item.refund_paise) - Number(item.refunded_paise)) / 100),
    ),
    [mode, setMode] = useState('CASH'),
    [reference, setReference] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Record customer refund" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post(`/sales/returns/${item.id}/refunds`, {
              amount_paise: paise(amount),
              mode,
              reference,
            });
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
              max={(Number(item.refund_paise) - Number(item.refunded_paise)) / 100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference">
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Record refund</button>
        </div>
      </form>
    </Modal>
  );
}
