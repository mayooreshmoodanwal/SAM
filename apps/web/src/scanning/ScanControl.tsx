import React, { lazy, Suspense, useRef, useState } from 'react';
import { post } from '../api';
import { Message } from '../ui';
import { useScanner } from './ScannerProvider';
import type { Scan, ScanContext } from './core';
const CameraScanner = lazy(() => import('./CameraScanner'));
export type Resolution = { found: boolean; status: string; code: any; product: any };
export function scanFailure(result: Resolution): string {
  const name = result.product?.name || 'Product';
  if (result.status === 'DISABLED_CODE') return `This barcode has been disabled for ${name}.`;
  if (result.status === 'INACTIVE_PRODUCT') return `${name} is inactive.`;
  if (result.status === 'OUT_OF_STOCK') return `${name} is out of stock.`;
  if (result.status === 'LEGACY_CONFLICT')
    return 'This legacy barcode has conflicting products. Ask an administrator to resolve it.';
  return `Barcode not recognized: ${typeof result.code === 'string' ? result.code : result.code?.value}`;
}
export function ScanControl({
  context,
  onResult,
  onCapture,
  vehicleId,
  enabled = true,
  onUnknown,
  manual = true,
  onPendingChange,
}: {
  context: ScanContext;
  onResult?: (result: Resolution, scan: Scan) => Promise<string | void> | string | void;
  onCapture?: (scan: Scan) => Promise<string | void> | string | void;
  vehicleId?: string;
  enabled?: boolean;
  onUnknown?: (scan: Scan) => void;
  manual?: boolean;
  onPendingChange?: (busy: boolean) => void;
}) {
  const [camera, setCamera] = useState(false),
    [manualOpen, setManualOpen] = useState(false),
    [value, setValue] = useState(''),
    [feedback, setFeedback] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const scanner = useScanner(async (scan) => {
    if (mounted.current) {
      setPending((n) => n + 1);
      setError('');
      pendingCallback.current?.(true);
    }
    try {
      let message: string | void;
      if (onCapture) message = await onCapture(scan);
      else {
        let result: Resolution;
        try {
          result = await post('/product-codes/resolve', {
            code: scan.code,
            scan_id: scan.id,
            source: scan.source,
            context,
            vehicle_id: vehicleId || null,
          });
        } catch (e: any) {
          throw new Error(
            e.message === 'Failed to fetch'
              ? 'Unable to verify product. Check network connection.'
              : e.message,
          );
        }
        if (!result.found) {
          onUnknown?.(scan);
          throw new Error(scanFailure(result));
        }
        message = await onResult?.(result, scan);
      }
      if (mounted.current) {
        setFeedback(message || 'Code captured.');
        setValue('');
      }
      if (scanner.settings.sound) {
        try {
          const audio = new AudioContext(),
            osc = audio.createOscillator(),
            gain = audio.createGain();
          gain.gain.value = 0.035;
          osc.frequency.value = 900;
          osc.connect(gain);
          gain.connect(audio.destination);
          osc.start();
          osc.stop(audio.currentTime + 0.07);
          osc.onended = () => {
            void audio.close();
          };
        } catch {}
      }
      return message;
    } catch (e: any) {
      if (mounted.current) {
        setFeedback('');
        setError(e.message || 'Unable to process scan. Try again.');
      }
      throw e;
    } finally {
      if (mounted.current) {
        setPending((n) => Math.max(0, n - 1));
        pendingCallback.current?.(false);
      }
    }
  }, enabled);
  React.useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 4500);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <div ref={scanner.root} className="scan-control">
      <div className="scanner-actions">
        <span className="scanner-status" role="status">
          ●{' '}
          {!scanner.ready
            ? 'Loading scanner settings…'
            : enabled && scanner.settings.enabled
              ? 'Scanner Ready'
              : 'Hardware scanner paused'}
          {pending ? ' · Processing…' : ''}
        </span>
        <button
          type="button"
          className="button outline"
          disabled={!enabled || !scanner.ready}
          onClick={() => setCamera(true)}
        >
          Scan with camera
        </button>
        {manual && (
          <button
            type="button"
            className="button outline"
            onClick={() => {
              setManualOpen((v) => !v);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            Enter code manually
          </button>
        )}
      </div>
      {manualOpen && (
        <div className="manual-scan" data-scanner-ignore>
          <input
            ref={input}
            aria-label="Barcode or QR value"
            value={value}
            maxLength={512}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (value.trim())
                  void scanner
                    .submit({ id: crypto.randomUUID(), code: value.trim(), source: 'MANUAL_CODE' })
                    .catch(() => {});
              }
            }}
          />
          <button
            type="button"
            className="button primary"
            disabled={!value.trim()}
            onClick={() =>
              void scanner
                .submit({ id: crypto.randomUUID(), code: value.trim(), source: 'MANUAL_CODE' })
                .catch(() => {})
            }
          >
            Resolve code
          </button>
        </div>
      )}
      <div aria-live="polite">
        <Message type="success">{feedback}</Message>
        <Message>{error}</Message>
      </div>
      {camera && (
        <Suspense fallback={<p role="status">Loading camera scanner…</p>}>
          <CameraScanner
            settings={scanner.settings}
            onScan={scanner.submit}
            onClose={() => setCamera(false)}
            onManual={() => {
              setCamera(false);
              setManualOpen(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
