# Shanti Auto Mobiles

Billing, stock, purchase, customer truck and warranty software for an Indian commercial vehicle parts counter. The interface is desktop first and keyboard friendly. The API owns all financial calculations and stock changes; React only presents data and collects input.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | React, TypeScript, Vite | Counter, master data and admin screens |
| API | Express, TypeScript, Zod | Authorization, validation and transaction services |
| Database | PostgreSQL | Business records, immutable stock ledger, audit log |
| Invoice PDF | PDFKit with bundled Noto fonts | Server-rendered A4 invoice |

`apps/api/src` is separated by domain: `auth`, `catalog`, `people`, `purchases`, `billing`, `operations`, and pure `tax` calculation. The SQL migrations live in `apps/api/migrations`. `docs/DOMAIN.md` records the transaction and relationship rules.

## Folder structure

```text
apps/api/src/          TypeScript API and domain services
apps/api/migrations/   Versioned PostgreSQL schema
apps/web/src/          React counter and administration UI
tests/                 Database-backed integration flow
docs/                  Domain and transaction design
compose.yaml           PostgreSQL, API and web containers
```

## Main workflows

- Parts with OEM, SKU, barcode, GST mode, shelf and stock thresholds; CSV import validates every row before commit.
- Opening stock, adjustments, purchases, sales, returns and cancellations leave stock ledger entries.
- Truck configuration to part compatibility is many to many. Customer vehicle lookup accepts registration, chassis or VIN.
- Billing supports keyboard search (F2), customer selection (F4), payment (F6), save (F8), split tenders, credit limits, server totals and print/PDF.
- Purchase receiving can be partial. It increases usable stock and supplier payables in one database transaction.
- Warranty claims reference original invoice lines, customers, trucks and parts.
- Dashboard and reports query actual database records. No frontend seed totals are shown.
- Two roles: administrator and counter operator. Server routes enforce permissions.
- Administrators can change their own password in Settings; a change revokes all their active sessions.

## Start with Docker

1. Copy `.env.example` to `.env`.
2. Set a unique `POSTGRES_PASSWORD` and a long random `SETUP_TOKEN`. Use URL-safe characters in the database password when using the provided Compose connection URL. The example uses production mode on localhost.
3. Run `docker compose up --build -d`.
4. Open `http://localhost:8080`. Enter the setup token and create the administrator.
5. In Settings, enter GSTIN, address and invoice footer and create counter staff. Add parts and opening stock, then register customer trucks and compatible configurations.

For an HTTPS deployment, set `APP_ORIGIN` to the exact public origin and `COOKIE_SECURE=true`. Put the web container behind a TLS reverse proxy. Plain HTTP and insecure cookies are accepted only for localhost. Do not expose the database or API directly to the internet.

## Local development

Requires Node.js 22+, npm and PostgreSQL 16+. Create a database, copy `.env.example` to `.env`, then set `DATABASE_URL`, `SETUP_TOKEN`, `NODE_ENV=development`, `APP_ORIGIN=http://localhost:5173` and `COOKIE_SECURE=false`. Export variables from `.env` with your shell or an env loader; the app does not silently load `.env`.

```sh
npm ci
npm run db:migrate
npm run dev
```

The web app runs on port 5173 and the API on 3001 by default. If either is occupied, set `PORT` and `API_PROXY_TARGET` as needed. For development-only sample data, set a unique `SEED_ADMIN_PASSWORD` (at least 12 characters) and run `npm run db:seed` on a fresh development database. This seed includes realistic Ashok Leyland parts, trucks, a purchase, an invoice and a warranty claim. It is never run automatically or in production.

For a local production-mode run without Docker, set `NODE_ENV=production`, `APP_ORIGIN=http://localhost:8080`, `COOKIE_SECURE=false` and a real `DATABASE_URL` in the ignored `.env`. Build first, then run the API and web preview in separate terminals:

```sh
set -a; . ./.env; set +a
npm ci
npm run db:migrate
npm run build
npm run start -w @sam/api
```

```sh
set -a; . ./.env; set +a
npm run preview -w @sam/web
```

Open `http://localhost:8080`. Vite preview is for local verification; use HTTPS hosting for a public deployment. Administrator passwords are salted and hashed in PostgreSQL. They are never stored in `.env`.

## Later Vercel deployment

Use two Vercel projects from this repository: root directory `apps/api` with the Express preset, and root directory `apps/web` with the Vite preset. The API project uses `apps/api/vercel.json` to package the invoice fonts. The web project uses `apps/web/vercel.json` to proxy `/api` to the API project. Its rewrite destination must match the API project's HTTPS origin. This keeps session cookies on the web origin.

Create a Neon project in the same region as the API deployment. In the API project's Vercel environment variables, set `DATABASE_URL` to Neon's **pooled** PostgreSQL URL (hostname contains `-pooler`), `APP_ORIGIN` to the web project's exact HTTPS origin, `COOKIE_SECURE=true`, and an initial `SETUP_TOKEN`. Keep these credentials out of Git. Neon's Vercel integration can provide `DATABASE_URL` automatically; check that it points to the intended branch and database. Set `DATABASE_URL_UNPOOLED` to Neon's **direct** URL for migrations, either in a local environment when running the command or in the API project's Vercel settings if you run migrations from there. Both Neon URLs should include `sslmode=require`.

Before serving traffic, run `npm run db:migrate` against the Neon database with `DATABASE_URL_UNPOOLED` set. The migration script uses a session advisory lock and rejects Neon's pooled endpoint. Run migrations from the repository root, such as from a terminal with both Neon URLs exported; do not run them automatically in every serverless function. Then use the web setup screen to create the hosted administrator. The local PostgreSQL account is not automatically present in Neon; restore a full database backup if you want to carry local data over. Use separate Neon branches or databases and exact origins for preview deployments.

Neon's [connection guide](https://neon.com/docs/get-started/connect-neon) explains pooled and direct URLs; Vercel's [Express deployment guide](https://vercel.com/docs/frameworks/backend/express) and [monorepo guidance](https://vercel.com/docs/monorepos) cover hosting. A public Vercel deployment still needs the two project URLs and Neon credentials; this repository does not contain them.

## Commands

```sh
npm run build          # type check and build both apps
npm test               # business logic unit tests
npm run test:integration # against a seeded local test API (see below)
npm run format:check   # code formatting check
npm run db:migrate     # apply pending SQL migrations
npm run db:seed        # optional development demo data
npm run db:prune-scans # prune scan audit logs older than retention period
npm run test:scanner-qa # automated QA on disposable PostgreSQL with Playwright
```

To run the integration flow, use a **disposable seeded database** and a local API. Set `TEST_API_URL=http://localhost:3001/api` and `TEST_ADMIN_PASSWORD` to the demo seed password, then run `npm run test:integration`. It creates test parts, invoices, payments, returns, reservations and a test employee.

For the end-to-end scanner suite, run `npm run test:scanner-qa`. This boots an isolated PostgreSQL instance, tests migration `010_product_codes.sql` with legacy conflict handling, validates server-side code resolution, and runs Playwright browser checks for keyboard burst handling, input coexistence, camera QR/barcode decoding, stock limits, label PDF printing, receiving, returns, and warranty lookups.

## Barcode & QR Scanner System

### Supported Input Methods
- **Hardware Scanners**: USB and Bluetooth barcode/QR scanners configured in HID Keyboard Wedge mode. The system detects rapid keystroke bursts (< 50 ms per character) ending with `Enter` or `Tab`, preserving normal manual typing even when inputs or search boxes are currently focused.
- **Camera Scanning**: Integrated WebRTC camera scanner (`@zxing/browser`) supporting rear/front cameras, continuous scanning, torch toggle, and stationary duplicate frame suppression.
- **Manual Fallback**: Quick manual code entry dialog available across all scanning workflows when camera or hardware scanners are unavailable.

### Supported Code Formats & Identification
- Supports Code 128, QR Code, EAN-13, EAN-8, UPC-A, UPC-E, Code 39, ITF, Codabar, and Data Matrix.
- Multiple barcodes/QRs can be mapped to a single part (e.g. manufacturer EAN, internal sticker, supplier codes).
- Administrators can generate collision-free internal barcodes (`SAM0000000001`) and QR codes (`SAM:P:00000001`) directly from the UI or during part creation.
- A designated **primary code** is rendered on default product labels.

### Printable Labels
- Generates print-ready vector PDF labels (compact shelf labels or A4 multi-label sheets).
- Labels display part name, internal SKU, selling price, MRP, GST rate, barcode/QR image, and primary vehicle fitment.
- Downloadable and printable directly from the part's *Codes & Labels* panel.

### Scanner-Integrated Workflows
1. **Counter Billing**: Instant product lookup and cart addition. Repeated scans increment quantity up to available physical stock. Live pricing, tax rules, and vehicle compatibility checks are validated against the backend.
2. **Goods Receiving**: Scans match items against remaining purchase order line quantities and block receiving un-ordered items.
3. **Sales Returns**: Scanning items verifies the product was part of the original invoice and pre-populates return line details.
4. **Warranty Claims**: Scanning part codes queries customer invoices and open claims for rapid counter triage.

### Migration & Conflict Resolution
- Schema migration `010_product_codes.sql` normalizes existing `parts.barcode` values without losing data.
- Duplicate legacy barcodes are safely recorded in `product_code_migration_conflicts` rather than failing the migration.
- Administrators can review legacy conflicts and explicitly reassign codes through the UI.

### Scan Audit & Log Retention
- Every scan event is logged in `product_scan_events` with scan timestamp, input source (`HARDWARE_KEYBOARD`, `CAMERA`, `MANUAL_CODE`), context, and operator session.
- To prevent unbounded table growth, run `npm run db:prune-scans` (configured via `SCAN_LOG_RETENTION_DAYS`, default 90 days).

## Business logic

All money is stored as integer paise, GST as basis points. A tax-inclusive ₹100 item at 18% has ₹84.75 taxable value and ₹15.25 GST; a tax-exclusive ₹100 item totals ₹118. `tax.ts` is the single calculation service. Invoice-wide discount reduces the gross payable and apportions the tax reduction.

`move_stock` locks the part, validates available quantity, updates stock and inserts an append-only movement in the same transaction. Sale and purchase services run inside transactions; concurrent operators cannot sell the same remaining unit twice. Invoice lines snapshot name, OEM, HSN, cost, price and tax mode. Returning or cancelling a sale creates corrective entries without deleting the original.

Compatibility is stored in `part_compatibility` between a part and technical `vehicle_configurations`. Customer trucks reference a configuration. Lookup resolves a truck and then its compatible parts.

Invoice numbers use `SAM/<April–March FY>/NNNNNN`. The database counter row is locked during invoice creation, and a unique constraint rejects duplicates.

## Backup and restore

Backups must contain the **entire PostgreSQL database**. Run these from the host with database access or adapt them with `docker compose exec -T db`:

```sh
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h localhost -U sam -d shanti_auto_mobiles -Fc -f sam-backup.dump
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h localhost -U sam -d shanti_auto_mobiles --clean --if-exists sam-backup.dump
```

The Compose database port is intentionally private. For Compose, use `docker compose exec -T db pg_dump -U sam -d shanti_auto_mobiles -Fc > sam-backup.dump` and `cat sam-backup.dump | docker compose exec -T db pg_restore -U sam -d shanti_auto_mobiles --clean --if-exists`. Test restoration on a separate database before relying on backups. Schedule external backups and protect dump files as sensitive business data.

## Deployment and operations

Run migrations before serving traffic. Persist the PostgreSQL volume. Set an exact `APP_ORIGIN`, HTTPS and secure cookies. Keep database credentials and setup token outside source control. Remove the setup token after creating the first administrator. Monitor API health at `/api/health` and retain regular database backups.

## Version 1 boundaries

CSV is the supported bulk part import format; Excel sheets can be saved as CSV. Admin-entered fitment is required; there is no Ashok Leyland catalogue or VIN decoding integration. Reports cover daily sales, stock aging and top parts. Advanced analytics, WhatsApp, GST filing exports, multi-branch accounting and e-invoicing are not connected. Negative stock is not permitted. A paid invoice is corrected through a sales return and recorded refund rather than cancellation.
