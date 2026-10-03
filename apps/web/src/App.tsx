import React, { useEffect, useRef, useState } from 'react';
import { api, post, financialYearLabel } from './api';
import { Message } from './ui';
import { Dashboard, Reports, Settings } from './pages/Overview';
import { Billing, InvoiceDetail } from './pages/Billing';
import { Parts, PartDetail, Stock, VehicleLookup } from './pages/Inventory';
import {
  Customers,
  CustomerDetail,
  Vehicles,
  VehicleDetail,
  Suppliers,
  SupplierDetail,
  Purchases,
  PurchaseDetail,
} from './pages/Records';
import { Warranty, Expenses } from './pages/Operations';

export type Nav = (path: string) => void;
const navItems = [
  ['dashboard', 'Dashboard'],
  ['billing', 'Billing'],
  ['parts', 'Parts'],
  ['lookup', 'Vehicle Lookup'],
  ['customers', 'Customers / Fleets'],
  ['purchases', 'Purchases'],
  ['suppliers', 'Suppliers'],
  ['stock', 'Stock'],
  ['warranty', 'Warranty'],
  ['expenses', 'Expenses'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
];
export default function App() {
  const [user, setUser] = useState<any>(null),
    [authLoading, setAuthLoading] = useState(true),
    [needsSetup, setNeedsSetup] = useState(false),
    [route, setRoute] = useState(location.hash.slice(1) || 'dashboard');
  const [globalQ, setGlobalQ] = useState(''),
    [search, setSearch] = useState<any>(null),
    [quick, setQuick] = useState(false),
    [now, setNow] = useState(new Date());
  const [notifications, setNotifications] = useState<any[]>([]),
    [showNotifications, setShowNotifications] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate: Nav = (path) => {
    location.hash = path;
    setRoute(path);
    setSearch(null);
    setQuick(false);
    setShowNotifications(false);
  };
  useEffect(() => {
    const handler = () => setRoute(location.hash.slice(1) || 'dashboard');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('sam:session-expired', handler);
    return () => window.removeEventListener('sam:session-expired', handler);
  }, []);
  useEffect(() => {
    Promise.allSettled([api('/auth/me'), api('/auth/setup-status')])
      .then(([me, setup]) => {
        if (me.status === 'fulfilled') setUser(me.value.user);
        if (setup.status === 'fulfilled') setNeedsSetup(setup.value.needsSetup);
      })
      .finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    if (globalQ.trim().length < 2) {
      setSearch(null);
      return;
    }
    const timer = setTimeout(
      () =>
        api('/search?q=' + encodeURIComponent(globalQ))
          .then(setSearch)
          .catch(() => setSearch(null)),
      180,
    );
    return () => clearTimeout(timer);
  }, [globalQ]);
  useEffect(() => {
    if (user)
      api('/notifications')
        .then(setNotifications)
        .catch(() => {});
  }, [user, route]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearch(null);
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  if (authLoading)
    return (
      <div className="startup">
        SHANTI AUTO MOBILES
        <br />
        <small>Loading workspace…</small>
      </div>
    );
  if (needsSetup) return <Setup onDone={() => setNeedsSetup(false)} />;
  if (!user) return <Login onLogin={setUser} />;
  const admin = user.role === 'ADMIN';
  const page = (() => {
    const [name, id] = route.split('/');
    switch (name) {
      case 'dashboard':
        return <Dashboard navigate={navigate} admin={admin} />;
      case 'billing':
        return <Billing navigate={navigate} admin={admin} initialPartId={id} />;
      case 'parts':
        return id ? (
          <PartDetail id={id} navigate={navigate} admin={admin} />
        ) : (
          <Parts navigate={navigate} admin={admin} />
        );
      case 'lookup':
        return <VehicleLookup navigate={navigate} />;
      case 'customers':
        return id ? (
          <CustomerDetail id={id} navigate={navigate} />
        ) : (
          <Customers navigate={navigate} />
        );
      case 'vehicles':
        return id ? (
          <VehicleDetail id={id} navigate={navigate} />
        ) : (
          <Vehicles navigate={navigate} />
        );
      case 'suppliers':
        return admin ? (
          id ? (
            <SupplierDetail id={id} navigate={navigate} />
          ) : (
            <Suppliers navigate={navigate} />
          )
        ) : null;
      case 'purchases':
        return admin ? (
          id ? (
            <PurchaseDetail id={id} navigate={navigate} />
          ) : (
            <Purchases navigate={navigate} />
          )
        ) : null;
      case 'invoices':
        return id ? <InvoiceDetail id={id} navigate={navigate} admin={admin} /> : null;
      case 'stock':
        return <Stock navigate={navigate} admin={admin} />;
      case 'warranty':
        return <Warranty navigate={navigate} admin={admin} />;
      case 'expenses':
        return admin ? <Expenses /> : null;
      case 'reports':
        return admin ? <Reports /> : null;
      case 'settings':
        return admin ? <Settings onPasswordChanged={() => setUser(null)} /> : null;
      default:
        return <Dashboard navigate={navigate} admin={admin} />;
    }
  })();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SA</div>
          <div>
            <strong>SHANTI AUTO</strong>
            <span>MOBILES · PARTS & BILLING</span>
          </div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {navItems
            .filter(
              ([key]) =>
                admin ||
                !['purchases', 'suppliers', 'expenses', 'reports', 'settings'].includes(key),
            )
            .map(([key, label]) => (
              <button
                key={key}
                className={'nav-item ' + (route.split('/')[0] === key ? 'active' : '')}
                onClick={() => navigate(key)}
              >
                <span className="nav-dot" />
                {label}
              </button>
            ))}
        </nav>
        <div className="sidebar-foot">
          <div className="status-dot" /> Counter system online
          <br />
          <small>Financial year {financialYearLabel(now)}</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="global-search">
            <span>⌕</span>
            <input
              ref={searchRef}
              placeholder="Search parts, chassis, invoice, customer…"
              value={globalQ}
              onChange={(e) => setGlobalQ(e.target.value)}
            />
            <kbd>⌘ K</kbd>
            {search && (
              <div className="search-results">
                {Object.entries(search).flatMap(([type, rows]: any) =>
                  rows.map((r: any) => (
                    <button
                      key={type + r.id}
                      onClick={() => {
                        navigate(
                          type === 'parts'
                            ? `parts/${r.id}`
                            : type === 'vehicles'
                              ? `vehicles/${r.id}`
                              : type === 'invoices'
                                ? `invoices/${r.id}`
                                : type === 'customers'
                                  ? `customers/${r.id}`
                                  : `suppliers/${r.id}`,
                        );
                        setGlobalQ('');
                      }}
                    >
                      <small>{type.toUpperCase()}</small>
                      <span>{r.name || r.invoice_number || r.registration_number || r.sku}</span>
                    </button>
                  )),
                )}
              </div>
            )}
          </div>
          <div className="top-actions">
            <span className="today">
              {now.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <div className="quick-wrap">
              <button
                className="notification"
                onClick={() => setShowNotifications(!showNotifications)}
                title="Operational alerts"
              >
                {notifications.length ? `● ${notifications.length}` : '○'}
              </button>
              {showNotifications && (
                <div className="quick-menu notice-menu">
                  {notifications.length ? (
                    notifications.map((n) => (
                      <button key={n.id} onClick={() => navigate(n.target)}>
                        <b>{n.title}</b>
                        <small>{n.detail}</small>
                      </button>
                    ))
                  ) : (
                    <p>No active alerts.</p>
                  )}
                </div>
              )}
            </div>
            <div className="quick-wrap">
              <button className="button primary" onClick={() => setQuick(!quick)}>
                ＋ Quick add
              </button>
              {quick && (
                <div className="quick-menu">
                  {[
                    ['billing', 'New invoice'],
                    ['parts', 'Parts'],
                    ['customers', 'Customers'],
                    ['lookup', 'Vehicle lookup'],
                    ['purchases', 'Purchases'],
                  ]
                    .filter(([k]) => admin || !['parts', 'purchases'].includes(k))
                    .map(([k, label]) => (
                      <button key={k} onClick={() => navigate(k)}>
                        {label}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <button
              className="user-pill"
              onClick={async () => {
                await post('/auth/logout', {});
                setUser(null);
              }}
              title="Sign out"
            >
              <b>{user.name.slice(0, 1)}</b>
              <span>
                {user.name}
                <small>{user.role === 'ADMIN' ? 'Administrator' : 'Counter operator'}</small>
              </span>
              ⌄
            </button>
          </div>
        </header>
        <main>{page}</main>
      </div>
    </div>
  );
}
function Setup({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState<any>({
    setupToken: '',
    adminName: '',
    adminEmail: '',
    password: '',
    businessName: 'Shanti Auto Mobiles',
    address: '',
    phone: '',
    gstin: '',
    state: '',
    invoicePrefix: 'SAM',
    defaultGstBps: 1800,
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const set = (key: string, value: any) => setV({ ...v, [key]: value });
  return (
    <div className="login-screen">
      <div className="setup-card">
        <div className="login-brand">
          <div className="brand-mark">SA</div>
          <div>
            <strong>SHANTI AUTO MOBILES</strong>
            <small>First-run setup</small>
          </div>
        </div>
        <h1>Set up your shop</h1>
        <p className="muted">
          Enter the setup token from your environment, then create the first administrator.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await post('/auth/setup', v);
              onDone();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            {[
              ['setupToken', 'Setup token'],
              ['adminName', 'Administrator name'],
              ['adminEmail', 'Administrator email'],
              ['password', 'Administrator password'],
              ['businessName', 'Shop name'],
              ['address', 'Address'],
              ['phone', 'Phone'],
              ['gstin', 'GSTIN'],
              ['state', 'State'],
              ['invoicePrefix', 'Invoice prefix'],
            ].map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  type={
                    key === 'password' || key === 'setupToken'
                      ? 'password'
                      : key === 'adminEmail'
                        ? 'email'
                        : 'text'
                  }
                  required={[
                    'setupToken',
                    'adminName',
                    'adminEmail',
                    'password',
                    'businessName',
                    'invoicePrefix',
                  ].includes(key)}
                  value={v[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            <label className="field">
              <span>Default GST %</span>
              <input
                type="number"
                min="0"
                max="100"
                value={v.defaultGstBps / 100}
                onChange={(e) => set('defaultGstBps', Math.round(Number(e.target.value) * 100))}
              />
            </label>
          </div>
          <Message>{error}</Message>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              {busy ? 'Setting up…' : 'Create administrator'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (user: any) => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">SA</div>
          <div>
            <strong>SHANTI AUTO MOBILES</strong>
            <small>Parts · Billing · Inventory</small>
          </div>
        </div>
        <h1>Sign in to counter</h1>
        <p>Use your staff account to continue.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const r = await post('/auth/login', { email, password });
              onLogin(r.user);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email address
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Message>{error}</Message>
          <button className="button primary wide" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <footer>Authorized staff only · Shanti Auto Mobiles</footer>
      </div>
    </div>
  );
}
