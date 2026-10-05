export type ScanSource = 'HARDWARE_KEYBOARD' | 'HARDWARE_HID' | 'CAMERA' | 'MANUAL_CODE';
export type ScanContext =
  | 'BILLING'
  | 'PRODUCT_LOOKUP'
  | 'PRODUCT_BARCODE_CAPTURE'
  | 'PURCHASE_RECEIVING'
  | 'STOCK_LOOKUP'
  | 'SALES_RETURN'
  | 'WARRANTY';
export type Scan = { id: string; code: string; source: ScanSource; format?: string };
export type ScannerSettings = {
  enabled: boolean;
  terminator: 'AUTO' | 'ENTER' | 'TAB';
  min_length: number;
  max_gap_ms: number;
  max_average_ms: number;
  sound: boolean;
  continuous_camera: boolean;
  camera_facing: 'environment' | 'user';
  camera_cooldown_ms: number;
};
export const defaultSettings: ScannerSettings = {
  enabled: true,
  terminator: 'AUTO',
  min_length: 4,
  max_gap_ms: 35,
  max_average_ms: 25,
  sound: false,
  continuous_camera: false,
  camera_facing: 'environment',
  camera_cooldown_ms: 1000,
};

export class KeyboardBurst {
  value = '';
  times: number[] = [];
  clear() {
    this.value = '';
    this.times = [];
  }
  push(key: string, time: number, settings: ScannerSettings): string | null {
    const last = this.times.at(-1);
    if (last !== undefined && time - last > settings.max_gap_ms) this.clear();
    const suffix = key === 'Enter' || key === 'Tab';
    if (suffix) {
      const allowed = settings.terminator === 'AUTO' || settings.terminator === key.toUpperCase();
      const code = this.value,
        duration = time - (this.times[0] ?? time),
        count = this.times.length;
      this.clear();
      return allowed && count >= settings.min_length && duration / count <= settings.max_average_ms
        ? code.trim() || null
        : null;
    }
    if (key.length !== 1 || this.value.length >= 512) {
      this.clear();
      return null;
    }
    this.value += key;
    this.times.push(time);
    return null;
  }
}

// A stationary label is one recognition event, regardless of frame rate.
export class CameraGate {
  private value = '';
  private seen = 0;
  private accepted = 0;
  reset() {
    this.value = '';
    this.seen = 0;
    this.accepted = 0;
  }
  accept(code: string, now: number, cooldown: number) {
    const can = code !== this.value || (now - this.seen >= 700 && now - this.accepted >= cooldown);
    this.seen = now;
    if (can) {
      this.value = code;
      this.accepted = now;
    }
    return can;
  }
}
export type CartLine = {
  part: any;
  quantity: number;
  discount: string;
  scanned_code_id?: string;
  added_via?: ScanSource;
};
export function addCartProduct(
  cart: CartLine[],
  part: any,
  meta?: { codeId?: string; source: ScanSource },
) {
  if (part.active === false) throw new Error(`${part.name} is inactive.`);
  const available = Number(
    part.available_stock ?? Number(part.current_stock) - Number(part.reserved_stock),
  );
  const found = cart.find((l) => l.part.id === part.id),
    quantity = (found?.quantity || 0) + 1;
  if (!Number.isSafeInteger(available) || available < quantity)
    throw new Error(
      available < 1
        ? `${part.name} is out of stock.`
        : `Only ${available} units of ${part.name} are available.`,
    );
  const line: CartLine = {
    part,
    quantity,
    discount: found?.discount || '0',
    scanned_code_id: meta?.codeId || found?.scanned_code_id,
    added_via: meta?.source || found?.added_via,
  };
  return {
    cart: found ? cart.map((l) => (l.part.id === part.id ? line : l)) : [...cart, line],
    quantity,
  };
}
