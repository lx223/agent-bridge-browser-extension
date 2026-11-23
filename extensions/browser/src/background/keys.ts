const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
type Modifier = keyof typeof MODIFIER_BITS;

const MODIFIER_ALIASES: Record<string, Modifier> = {
  alt: 'Alt',
  option: 'Alt',
  control: 'Control',
  ctrl: 'Control',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  shift: 'Shift',
};

interface NamedKey {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, NamedKey> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }]),
  ),
};

const MODIFIER_KEYS: Record<Modifier, NamedKey> = {
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
};

function printableKey(char: string, shift: boolean): NamedKey {
  if (/^[a-z]$/i.test(char)) {
    const upper = char.toUpperCase();
    const key = shift ? upper : char.toLowerCase();
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
  }
  if (/^\d$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
  return { key: char, code: '', keyCode: 0, text: char };
}

export interface KeyEventParams {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown';
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
}

export function parseKeyCombo(combo: string): KeyEventParams[] {
  const parts = combo.split(/\+(?=.)/);
  const keyName = parts.pop();
  if (!keyName) throw new Error(`Invalid key: "${combo}"`);

  const modifiers: Modifier[] = parts.map((part) => {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier) throw new Error(`Unknown modifier "${part}" in "${combo}"`);
    return modifier;
  });
  const bits = modifiers.reduce((sum, m) => sum | MODIFIER_BITS[m], 0);

  const named = NAMED_KEYS[keyName.toLowerCase()];
  if (!named && [...keyName].length !== 1) throw new Error(`Unknown key "${keyName}"`);
  const main = named ?? printableKey(keyName, modifiers.includes('Shift'));
  const producesText = main.text !== undefined && !modifiers.some((m) => m !== 'Shift');

  const events: KeyEventParams[] = [];
  let held = 0;
  for (const modifier of modifiers) {
    held |= MODIFIER_BITS[modifier];
    const k = MODIFIER_KEYS[modifier];
    events.push({ type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers: held });
  }
  events.push({
    type: producesText ? 'keyDown' : 'rawKeyDown',
    key: main.key,
    code: main.code,
    windowsVirtualKeyCode: main.keyCode,
    modifiers: bits,
    ...(producesText && { text: main.text }),
  });
  events.push({ type: 'keyUp', key: main.key, code: main.code, windowsVirtualKeyCode: main.keyCode, modifiers: bits });
  for (const modifier of [...modifiers].reverse()) {
    held &= ~MODIFIER_BITS[modifier];
    const k = MODIFIER_KEYS[modifier];
    events.push({ type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers: held });
  }
  return events;
}
