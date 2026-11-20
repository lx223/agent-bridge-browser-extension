import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type HelloMessage } from '@agent-browser-bridge/protocol';
import { describeInstance, findInstance, InstanceSelector } from './instances.ts';

const hello = (instanceId: string | undefined, extra: Partial<HelloMessage> = {}): HelloMessage => ({
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  extensionVersion: '1.0.0',
  userAgent: 'test',
  browser: 'chrome',
  instanceId,
  label: 'Chrome',
  ...extra,
});

const WORK = hello('aaaa1111', { name: 'Work' });
const PERSONAL = hello('bbbb2222', { name: 'Personal' });
const EDGE = hello('cccc3333', { label: 'Edge' });
const SAFARI = hello('dddd4444', { browser: 'safari', label: 'Safari' });

function selectorOver(initial: HelloMessage[]) {
  let connected = initial;
  const selector = new InstanceSelector(() => connected);
  return { selector, connect: (next: HelloMessage[]) => (connected = next) };
}

describe('describeInstance', () => {
  it('leads with the name the user chose', () => {
    expect(describeInstance(WORK)).toBe('"Work" (Chrome, aaaa1111)');
  });

  it('falls back to the id and browser label', () => {
    expect(describeInstance(EDGE)).toBe('cccc3333 (Edge)');
    expect(describeInstance(hello(undefined, { label: undefined }))).toBe('unknown (chrome)');
  });
});

describe('findInstance', () => {
  it('only matches instances of the given browser', () => {
    expect(findInstance([SAFARI], 'chrome', 'dddd4444')).toBeUndefined();
    expect(findInstance([WORK, SAFARI], 'chrome', 'WORK')).toBe(WORK);
  });
});

describe('InstanceSelector', () => {
  it('uses and pins the only connected instance of a browser', () => {
    const { selector } = selectorOver([WORK, SAFARI]);
    expect(selector.select('chrome')).toEqual({ instance: 'aaaa1111', answeredBy: WORK });
    expect(selector.select('safari')).toEqual({ instance: 'dddd4444', answeredBy: SAFARI });
  });

  it('leaves the choice to the bridge when nothing or several instances are connected', () => {
    expect(selectorOver([]).selector.select('chrome')).toEqual({});
    expect(selectorOver([WORK, PERSONAL]).selector.select('chrome')).toEqual({});
  });

  it('cannot pin a legacy extension without an instance id', () => {
    const { selector, connect } = selectorOver([hello(undefined)]);
    expect(selector.select('chrome')).toEqual({});
    connect([PERSONAL]);
    expect(selector.select('chrome')).toEqual({ instance: 'bbbb2222', answeredBy: PERSONAL });
  });

  it('refuses to fall through to another instance after the pinned one disconnects', () => {
    const { selector, connect } = selectorOver([WORK]);
    selector.select('chrome');
    connect([PERSONAL]);
    expect(() => selector.select('chrome')).toThrow(
      'The chrome instance this session was using, "Work" (Chrome, aaaa1111), is not connected right now. ' +
        'Tab, window and group ids from it do not apply to other instances. ' +
        'Connected chrome instances: "Personal" (Chrome, bbbb2222). ' +
        'Wait for it to reconnect, or pass instance to switch and list tabs again.',
    );
    connect([]);
    expect(() => selector.select('chrome')).toThrow(/Connected chrome instances: none\./);
  });

  it('picks the pinned instance up again once it reconnects', () => {
    const { selector, connect } = selectorOver([WORK]);
    selector.select('chrome');
    connect([]);
    expect(() => selector.select('chrome')).toThrow();
    connect([PERSONAL, WORK]);
    expect(selector.select('chrome')).toEqual({ instance: 'aaaa1111', answeredBy: WORK });
  });

  it('stays on the instance last chosen explicitly, even with several connected', () => {
    const { selector } = selectorOver([WORK, PERSONAL]);
    expect(selector.select('chrome', 'bbbb2222').instance).toBe('bbbb2222');
    expect(selector.select('chrome')).toEqual({ instance: 'bbbb2222', answeredBy: PERSONAL });
    expect(selector.select('chrome', 'aaaa1111').instance).toBe('aaaa1111');
    expect(selector.select('chrome').instance).toBe('aaaa1111');
  });

  it('accepts the name the user chose, ignoring case and surrounding spaces', () => {
    const { selector } = selectorOver([WORK, PERSONAL]);
    expect(selector.select('chrome', ' work ')).toEqual({ instance: 'aaaa1111', answeredBy: WORK });
    expect(selector.select('chrome').instance).toBe('aaaa1111');
  });

  it('prefers an exact instance id over a name', () => {
    const named = hello('bbbb2222', { name: 'aaaa1111' });
    const { selector } = selectorOver([named, WORK]);
    expect(selector.select('chrome', 'aaaa1111').instance).toBe('aaaa1111');
  });

  it('refuses a name shared by several instances', () => {
    const twin = hello('eeee5555', { name: 'work' });
    const { selector } = selectorOver([WORK, twin]);
    expect(() => selector.select('chrome', 'Work')).toThrow(
      'Several chrome instances are named "Work": "Work" (Chrome, aaaa1111), "work" (Chrome, eeee5555). Pass the instance id instead.',
    );
  });

  it('points the agent at identifying instances when no instance matches', () => {
    const { selector } = selectorOver([WORK, EDGE]);
    expect(() => selector.select('chrome', 'office')).toThrow(
      'No connected chrome instance has the id or name "office". Connected chrome instances: "Work" (Chrome, aaaa1111), cccc3333 (Edge). ' +
        'If you cannot tell which one the user means, call browser_identify_instances, show the user their sample tabs, ask, and save the answer with browser_name_instance.',
    );
    expect(selector.select('chrome', 'aaaa1111').instance).toBe('aaaa1111');
  });

  it('leaves an unknown instance to the bridge while nothing of that browser is connected', () => {
    const { selector, connect } = selectorOver([SAFARI]);
    expect(selector.select('chrome', 'missing')).toEqual({ instance: 'missing' });
    connect([WORK]);
    expect(selector.select('chrome')).toEqual({ instance: 'aaaa1111', answeredBy: WORK });
  });

  it('keeps one pin per browser', () => {
    const { selector } = selectorOver([WORK, SAFARI]);
    selector.select('chrome');
    selector.select('safari');
    expect(selector.select('chrome').instance).toBe('aaaa1111');
    expect(selector.select('safari').instance).toBe('dddd4444');
  });

  it('reports the latest name of the pinned instance', () => {
    const { selector, connect } = selectorOver([WORK]);
    selector.select('chrome');
    const renamed = { ...WORK, name: 'Office' };
    connect([renamed]);
    expect(selector.select('chrome').answeredBy).toBe(renamed);
  });
});
