import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Modal, Message, Field } from '../ui';
import { CameraGate, type Scan, type ScannerSettings } from './core';

export default function CameraScanner({
  settings,
  onScan,
  onClose,
  onManual,
}: {
  settings: ScannerSettings;
  onScan: (scan: Scan) => Promise<unknown>;
  onClose: () => void;
  onManual: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null),
    gate = useRef(new CameraGate()),
    callbacks = useRef({ onScan, onClose });
  callbacks.current = { onScan, onClose };
  const [error, setError] = useState(''),
    [device, setDevice] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [retry, setRetry] = useState(0),
    [continuous, setContinuous] = useState(settings.continuous_camera),
    [torch, setTorch] = useState(false),
    [hasTorch, setHasTorch] = useState(false),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState('');
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  useEffect(() => {
    let live = true,
      processing = false,
      stream: MediaStream | undefined;
    setError('');
    setHasTorch(false);
    setTorch(false);
    gate.current.reset();
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          'Camera scanning is unavailable here. Use HTTPS or localhost, a connected scanner, or manual entry.',
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: device
            ? { deviceId: { exact: device } }
            : {
                facingMode: { ideal: settings.camera_facing },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        });
        if (!live) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const inputs = await navigator.mediaDevices.enumerateDevices();
        if (!live) return;
        setDevices(inputs.filter((d) => d.kind === 'videoinput'));
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.DATA_MATRIX,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 150,
        });
        const scanner = await reader.decodeFromStream(stream, video.current!, async (result) => {
          if (!live || !result || processing) return;
          const code = result.getText().trim();
          if (!code || !gate.current.accept(code, performance.now(), settings.camera_cooldown_ms))
            return;
          processing = true;
          setBusy(true);
          setFeedback('Checking code…');
          try {
            await callbacks.current.onScan({
              id: crypto.randomUUID(),
              code,
              source: 'CAMERA',
              format: BarcodeFormat[result.getBarcodeFormat()],
            });
            if (!live) return;
            setFeedback('Scan processed. Point at the next label.');
            if (!continuousRef.current) callbacks.current.onClose();
          } catch (e: any) {
            if (live) setFeedback(e.message || 'Unable to process scan. Try again.');
          } finally {
            processing = false;
            if (live) setBusy(false);
          }
        });
        if (!live) {
          scanner.stop();
          return;
        }
        controls.current = scanner;
        setHasTorch(!!scanner.switchTorch);
      } catch (e: any) {
        stream?.getTracks().forEach((t) => t.stop());
        if (live)
          setError(
            e.name === 'NotAllowedError'
              ? 'Camera permission is required for camera scanning. Allow access in browser settings and try again.'
              : e.name === 'NotFoundError'
                ? 'No camera was found. Use a connected scanner or manual entry.'
                : 'Camera could not start. Close other camera apps and try again.',
          );
      }
    }
    void start();
    return () => {
      live = false;
      controls.current?.stop();
      controls.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [device, retry, settings.camera_facing, settings.camera_cooldown_ms]);
  return (
    <Modal title="Scan with camera" onClose={onClose}>
      <div className="camera-scanner" data-scanner-ignore>
        <p>Point camera at barcode or QR code</p>
        <div className="camera-view">
          <video ref={video} autoPlay muted playsInline />
          <div className="camera-frame" aria-hidden="true" />
        </div>
        <Message>{error}</Message>
        <p role="status" aria-live="polite">
          {busy ? 'Checking product…' : feedback}
        </p>
        {devices.length > 1 && (
          <Field label="Camera">
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              <option value="">Preferred camera</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={continuous}
            onChange={(e) => setContinuous(e.target.checked)}
          />
          Continuous scanning
        </label>
        <div className="scanner-actions">
          {hasTorch && (
            <button
              type="button"
              className="button outline"
              onClick={async () => {
                try {
                  await controls.current?.switchTorch?.(!torch);
                  setTorch(!torch);
                } catch {
                  setError('Torch is unavailable on this camera.');
                }
              }}
            >
              {torch ? 'Turn torch off' : 'Turn torch on'}
            </button>
          )}
          <button
            type="button"
            className="button outline"
            disabled={busy}
            onClick={() => {
              gate.current.reset();
              setFeedback('Ready for another scan of this label.');
            }}
          >
            Scan same label again
          </button>
          {error && (
            <button type="button" className="button outline" onClick={() => setRetry(retry + 1)}>
              Try again
            </button>
          )}
          <button type="button" className="button outline" onClick={onManual}>
            Enter code manually
          </button>
          <button type="button" className="button outline" onClick={onClose}>
            Use hardware scanner / Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
