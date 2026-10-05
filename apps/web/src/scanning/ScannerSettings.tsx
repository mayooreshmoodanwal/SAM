import React, { useState, useEffect } from 'react';
import { Panel, Field, Message } from '../ui';
import { useScannerSettings } from './ScannerProvider';
export function ScannerSettingsPanel() {
  const { settings, save } = useScannerSettings(),
    [draft, setDraft] = useState(settings),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <Panel title="Billing · Scanner">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save(draft);
            setMessage('Scanner settings saved.');
          } catch (e: any) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          Recommended: USB or Bluetooth HID keyboard mode, Enter / CR suffix. “Scanner Ready” means
          the app is listening; browsers cannot confirm a keyboard scanner is physically connected.
        </p>
        <div className="form-grid">
          <Field label="Hardware scanner">
            <select
              value={String(draft.enabled)}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.value === 'true' })}
            >
              <option value="true">Enabled · Keyboard mode</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <Field label="Scan terminator">
            <select
              value={draft.terminator}
              onChange={(e) =>
                setDraft({ ...draft, terminator: e.target.value as typeof draft.terminator })
              }
            >
              <option value="AUTO">Auto · Enter or Tab</option>
              <option value="ENTER">Enter / CR</option>
              <option value="TAB">Tab</option>
            </select>
          </Field>
          <Field label="Minimum code length">
            <input
              type="number"
              min="1"
              max="32"
              value={draft.min_length}
              onChange={(e) => setDraft({ ...draft, min_length: Number(e.target.value) })}
            />
          </Field>
          <Field label="Camera preference">
            <select
              value={draft.camera_facing}
              onChange={(e) =>
                setDraft({ ...draft, camera_facing: e.target.value as 'environment' | 'user' })
              }
            >
              <option value="environment">Back camera</option>
              <option value="user">Front camera</option>
            </select>
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.sound}
              onChange={(e) => setDraft({ ...draft, sound: e.target.checked })}
            />
            Soft success sound
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.continuous_camera}
              onChange={(e) => setDraft({ ...draft, continuous_camera: e.target.checked })}
            />
            Continuous camera scanning by default
          </label>
        </div>
        <details>
          <summary>Timing sensitivity · adjust only if your scanner needs it</summary>
          <p>
            Defaults accept rapid scanner bursts and preserve normal typing. A label held in view is
            counted once; remove and re-present it, or tap “Scan same label again”.
          </p>
          <div className="form-grid">
            <Field label="Maximum gap between keys (ms)">
              <input
                type="number"
                min="10"
                max="100"
                value={draft.max_gap_ms}
                onChange={(e) => setDraft({ ...draft, max_gap_ms: Number(e.target.value) })}
              />
            </Field>
            <Field label="Maximum average key interval (ms)">
              <input
                type="number"
                min="5"
                max="80"
                value={draft.max_average_ms}
                onChange={(e) => setDraft({ ...draft, max_average_ms: Number(e.target.value) })}
              />
            </Field>
            <Field label="Repeat camera cooldown (ms)">
              <input
                type="number"
                min="500"
                max="5000"
                value={draft.camera_cooldown_ms}
                onChange={(e) => setDraft({ ...draft, camera_cooldown_ms: Number(e.target.value) })}
              />
            </Field>
          </div>
        </details>
        <Message type={message === 'Scanner settings saved.' ? 'success' : 'error'}>
          {message}
        </Message>
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            Save scanner settings
          </button>
        </div>
      </form>
    </Panel>
  );
}
