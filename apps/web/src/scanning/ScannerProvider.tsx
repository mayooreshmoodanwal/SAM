import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, patch } from '../api';
import { KeyboardBurst, defaultSettings, type Scan, type ScannerSettings } from './core';

type Handler = {
  id: symbol;
  root: React.RefObject<HTMLElement>;
  run: (scan: Scan) => Promise<unknown>;
  live: boolean;
};
type Context = {
  ready: boolean;
  settings: ScannerSettings;
  save: (s: ScannerSettings) => Promise<void>;
  register: (h: Handler) => () => void;
  submit: (h: Handler, scan: Scan) => Promise<unknown>;
};
const ScannerContext = createContext<Context | null>(null);
export function ScannerProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const handlers = useRef<Handler[]>([]),
    queue = useRef(Promise.resolve<unknown>(undefined)),
    seen = useRef(new Set<string>());
  const submit = (handler: Handler, scan: Scan): Promise<unknown> => {
    if (seen.current.has(scan.id)) return Promise.resolve();
    seen.current.add(scan.id);
    if (seen.current.size > 200) seen.current.delete(seen.current.values().next().value!);
    const result = queue.current
      .catch(() => {})
      .then(() => (handler.live ? handler.run(scan) : undefined));
    queue.current = result.catch(() => {});
    return result;
  };
  useEffect(() => {
    api<ScannerSettings>('/scanner/settings')
      .then(setSettings)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const burst = new KeyboardBurst();
    let snapshot: {
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      value: string;
      start: number | null;
      end: number | null;
    } | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const clear = () => {
      burst.clear();
      snapshot = null;
    };
    const listener = (e: KeyboardEvent) => {
      const handler = handlers.current.at(-1),
        config = settingsRef.current;
      if (
        !handler ||
        !config.enabled ||
        e.isComposing ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.repeat
      ) {
        clear();
        return;
      }
      const modal = Array.from(document.querySelectorAll('.modal-backdrop')).at(-1);
      if (modal && !modal.contains(handler.root.current)) {
        clear();
        return;
      }
      if (e.key === 'Shift') return;
      if (burst.times.length && performance.now() - burst.times.at(-1)! > config.max_gap_ms)
        clear();
      const target = e.target as HTMLElement;
      if (
        target.closest('[data-scanner-ignore]') ||
        target.isContentEditable ||
        (target instanceof HTMLInputElement && target.type === 'password')
      ) {
        clear();
        return;
      }
      if (!burst.value && e.key.length === 1) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        )
          snapshot = {
            element: target,
            value: target.value,
            start: 'selectionStart' in target ? target.selectionStart : null,
            end: 'selectionEnd' in target ? target.selectionEnd : null,
          };
      }
      const code = burst.push(e.key, performance.now(), config);
      clearTimeout(timer);
      if (code) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const saved = snapshot;
        clear();
        // Restore the focused field to its state before the scanner's keyboard burst.
        // Normal typing is never prevented or replayed.
        if (saved && saved.element.isConnected)
          flushSync(() => {
            const proto =
              saved.element instanceof HTMLInputElement
                ? HTMLInputElement.prototype
                : saved.element instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLSelectElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(saved.element, saved.value);
            saved.element.dispatchEvent(
              new Event(saved.element instanceof HTMLSelectElement ? 'change' : 'input', {
                bubbles: true,
              }),
            );
            if (saved.start !== null && 'setSelectionRange' in saved.element)
              saved.element.setSelectionRange(saved.start, saved.end);
          });
        void submit(handler, { id: crypto.randomUUID(), code, source: 'HARDWARE_KEYBOARD' }).catch(
          () => {},
        );
      } else timer = setTimeout(clear, config.max_gap_ms + 5);
    };
    window.addEventListener('keydown', listener, true);
    window.addEventListener('blur', clear);
    return () => {
      clearTimeout(timer);
      clear();
      window.removeEventListener('keydown', listener, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return (
    <ScannerContext.Provider
      value={{
        ready,
        settings,
        save: async (s) => {
          const result = await patch<ScannerSettings>('/scanner/settings', s);
          setSettings(result);
        },
        register: (h) => {
          handlers.current.push(h);
          return () => {
            h.live = false;
            handlers.current = handlers.current.filter((x) => x !== h);
          };
        },
        submit,
      }}
    >
      {children}
    </ScannerContext.Provider>
  );
}
export function useScannerSettings() {
  const context = useContext(ScannerContext);
  if (!context) throw new Error('Scanner provider is missing.');
  return context;
}
export function useScanner(onScan: (scan: Scan) => Promise<unknown>, enabled = true) {
  const context = useScannerSettings(),
    callback = useRef(onScan);
  callback.current = onScan;
  const root = useRef<HTMLDivElement>(null),
    handler = useRef<Handler>({ id: Symbol(), root, run: (s) => callback.current(s), live: true });
  const register = useRef(context.register);
  register.current = context.register;
  useEffect(() => {
    if (!enabled || !context.ready) return;
    handler.current.live = true;
    return register.current(handler.current);
  }, [enabled, context.ready]);
  return {
    root,
    ready: context.ready,
    settings: context.settings,
    submit: (scan: Scan) => context.submit(handler.current, scan),
  };
}
