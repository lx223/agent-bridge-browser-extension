import { describe, expect, it } from 'vitest';
import { parseKeyCombo } from './keys.ts';

describe('parseKeyCombo', () => {
  it('sends Enter with a carriage return so forms submit', () => {
    expect(parseKeyCombo('Enter')).toEqual([
      { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 0, text: '\r' },
      { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 0 },
    ]);
  });

  it('wraps a shortcut in modifier presses without producing text', () => {
    const events = parseKeyCombo('Control+Shift+k');
    expect(events.map((e) => `${e.type}:${e.key}:${e.modifiers}`)).toEqual([
      'rawKeyDown:Control:2',
      'rawKeyDown:Shift:10',
      'rawKeyDown:K:10',
      'keyUp:K:10',
      'keyUp:Shift:2',
      'keyUp:Control:0',
    ]);
    expect(events.some((e) => e.text)).toBe(false);
  });

  it('types shifted letters and accepts aliases and a literal plus', () => {
    expect(parseKeyCombo('Shift+a')[1]).toMatchObject({ type: 'keyDown', key: 'A', code: 'KeyA', text: 'A' });
    expect(parseKeyCombo('cmd+a')[0]).toMatchObject({ key: 'Meta', modifiers: 4 });
    expect(parseKeyCombo('Control++').at(1)).toMatchObject({ key: '+' });
    expect(parseKeyCombo('esc')[0]).toMatchObject({ key: 'Escape', windowsVirtualKeyCode: 27 });
  });

  it('rejects unknown keys and modifiers', () => {
    expect(() => parseKeyCombo('Hyper+a')).toThrow('Unknown modifier');
    expect(() => parseKeyCombo('NotAKey')).toThrow('Unknown key');
  });
});
