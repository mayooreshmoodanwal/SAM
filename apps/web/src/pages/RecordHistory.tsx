import React, { useState } from 'react';
import { post, rupees, dateTime } from '../api';
import { Panel, Table, Modal, Field, Message, useData } from '../ui';

export function CustomerHistory({ data }: { data: any }) {
  return (
    <>
      <div className="two-col">
        <Panel title="Payment history">
          <Table
            rows={data?.payments || []}
            columns={[
              { key: 'paid_at', label: 'Date', render: (r) => dateTime(r.paid_at) },
              { key: 'invoice_number', label: 'Invoice' },
              { key: 'mode', label: 'Mode' },
              { key: 'amount_paise', label: 'Amount', render: (r) => rupees(r.amount_paise) },
            ]}
          />
        </Panel>
        <Panel title="Returns">
          <Table
            rows={data?.returns || []}
            columns={[
              { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
              { key: 'invoice_number', label: 'Invoice' },
              { key: 'reason', label: 'Reason' },
              { key: 'refund_paise', label: 'Refund due', render: (r) => rupees(r.refund_paise) },
            ]}
          />
        </Panel>
      </div>
      <Panel title="Frequently purchased parts">
        <Table
          rows={data?.frequentParts || []}
          columns={[
            { key: 'name', label: 'Part' },
            { key: 'sku', label: 'SKU' },
            { key: 'quantity', label: 'Net quantity' },
          ]}
        />
      </Panel>
    </>
  );
}
export function VehicleHistory({ id }: { id: string }) {
  const [refresh, setRefresh] = useState(0),
    [adding, setAdding] = useState(false),
    { data } = useData('/vehicles/' + id, refresh);
  return (
    <>
      <Panel
        title="Service visits, replacements & notes"
        action={
          <button className="button outline" onClick={() => setAdding(true)}>
            ＋ Add entry
          </button>
        }
      >
        <Table
          rows={data?.events || []}
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            { key: 'type', label: 'Type' },
            { key: 'description', label: 'Description' },
            { key: 'odometer', label: 'Odometer' },
            { key: 'created_by_name', label: 'Recorded by' },
          ]}
          empty="No service entries yet."
        />
      </Panel>
      {adding && (
        <VehicleEventForm
          id={id}
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
function VehicleEventForm({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState('SERVICE_VISIT'),
    [description, setDescription] = useState(''),
    [odometer, setOdometer] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Add vehicle history entry" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/vehicles/' + id + '/events', {
              type,
              description,
              odometer: odometer ? Number(odometer) : undefined,
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Entry type">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="SERVICE_VISIT">Service visit</option>
              <option value="REPLACEMENT">Replacement</option>
              <option value="NOTE">Note</option>
            </select>
          </Field>
          <Field label="Odometer">
            <input
              type="number"
              min="0"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            required
            minLength={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Message>{error}</Message>
        <div className="form-actions">
          <button className="button primary">Save entry</button>
        </div>
      </form>
    </Modal>
  );
}
export function SupplierHistory({ data }: { data: any }) {
  return (
    <>
      <div className="two-col">
        <Panel title="Parts supplied">
          <Table
            rows={data?.parts || []}
            columns={[
              { key: 'name', label: 'Part' },
              { key: 'sku', label: 'SKU' },
              { key: 'received', label: 'Units received' },
              {
                key: 'last_rate_paise',
                label: 'Last rate',
                render: (r) => rupees(r.last_rate_paise),
              },
            ]}
          />
        </Panel>
        <Panel title="Supplier payments">
          <Table
            rows={data?.payments || []}
            columns={[
              { key: 'paid_at', label: 'Date', render: (r) => dateTime(r.paid_at) },
              { key: 'purchase_number', label: 'Purchase' },
              { key: 'mode', label: 'Mode' },
              { key: 'amount_paise', label: 'Amount', render: (r) => rupees(r.amount_paise) },
            ]}
          />
        </Panel>
      </div>
      <Panel title="Purchase returns">
        <Table
          rows={data?.returns || []}
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) },
            { key: 'purchase_number', label: 'Purchase' },
            { key: 'part_name', label: 'Part' },
            { key: 'quantity', label: 'Qty' },
            { key: 'credit_paise', label: 'Credit', render: (r) => rupees(r.credit_paise) },
          ]}
        />
      </Panel>
    </>
  );
}
export function PurchaseHistory({ data }: { data: any }) {
  return (
    <>
      <div className="two-col">
        <Panel title="Goods receipts">
          <Table
            rows={data?.receipts || []}
            columns={[
              { key: 'received_at', label: 'Received', render: (r) => dateTime(r.received_at) },
              { key: 'quantity', label: 'Qty' },
              { key: 'free_quantity', label: 'Free' },
              { key: 'value_paise', label: 'Value', render: (r) => rupees(r.value_paise) },
            ]}
          />
        </Panel>
        <Panel title="Supplier payments">
          <Table
            rows={data?.payments || []}
            columns={[
              { key: 'paid_at', label: 'Date', render: (r) => dateTime(r.paid_at) },
              { key: 'mode', label: 'Mode' },
              { key: 'amount_paise', label: 'Amount', render: (r) => rupees(r.amount_paise) },
              { key: 'reference', label: 'Reference' },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
