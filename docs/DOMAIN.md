# Domain and transaction design

Amounts are integer paise and GST rates are basis points. Quantities are whole units in version 1. Every stock movement is performed by the database `move_stock` function, which locks the part row, checks available stock, updates the quantity and writes the immutable ledger entry in one transaction. Reservations affect `reserved_stock`, not `current_stock`. Damaged returns affect `damaged_stock`, not saleable stock.

Completed invoices snapshot part name, OEM, HSN, cost, price mode, rate and tax. Server calculations ignore client totals. A sale locks all part rows in ID order, allocates a financial-year invoice number under a row lock, inserts invoice, lines and payments, deducts stock, then commits. Failure rolls the entire operation back. Invoice cancellation and returns produce linked corrective records; they never remove history. Credit is the invoice total less non-credit payments and is checked under a customer row lock.

Purchases move Draft → Ordered → Partially Received → Received. Receiving locks purchase lines, caps receipts at remaining ordered quantity, records received and free quantity, calculates landed unit cost, raises supplier balance and writes ledger movements in a transaction. Purchase returns reduce usable stock and supplier balance with their own ledger entries.

Vehicle configurations describe technical fitment. Customer vehicles reference a configuration; the many-to-many `part_compatibility` table maps configurations to parts. Registration, chassis and VIN lookup resolves the customer vehicle first, then compatible parts. Warranty claims reference the original invoice line and inherit its customer, vehicle, part and warranty dates.

Permissions are enforced at API routes. Admin owns master data, adjustments, purchases, reports and settings. Counter operators can search, bill, view permitted history and create linked return or warranty requests. Session tokens are opaque, stored as SHA-256 digests, and sent in HttpOnly SameSite cookies. Mutations require a same-origin `Origin` header. Audit records are append only.

Invoice numbering uses `SAM/<FY>/NNNNNN`, where FY is April–March. The `invoice_counters` row is locked inside the sale transaction, ensuring uniqueness across concurrent operators. Local GST splits into CGST and SGST; interstate GST uses IGST. A single pure tax service computes every line and invoice total.
