export interface PopoverContent {
  askId: string;
  heading: string;
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmedText: string;
  cancelledText: string;
  dragHint: string;
  dir: 'ltr' | 'rtl';
  themeCss: string;
}

export type PopoverAnswer = 'pending' | 'confirmed' | 'cancelled' | 'gone';

export function showPopover(content: PopoverContent): void {
  const tag = 'agent-browser-bridge-ask';
  const stateKey = '__agentBrowserBridgeAsk';
  const armDelayMs = 400;
  const closeDelayMs = 1_200;
  const edge = 8;

  for (const old of Array.from(document.querySelectorAll(tag))) old.remove();

  const host = document.createElement(tag);
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'top: 16px',
    `${content.dir === 'rtl' ? 'left' : 'right'}: 16px`,
    'z-index: 2147483647',
    'display: block',
    'width: min(340px, calc(100vw - 32px))',
  ]
    .map((rule) => `${rule} !important`)
    .join(';');

  const state = { askId: content.askId, answer: 'pending', host };
  (globalThis as unknown as Record<string, unknown>)[stateKey] = state;

  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      ${content.themeCss}
      :host { color-scheme: light dark; }
      .card {
        --lift: 0 1px 2px rgb(28 25 23 / 0.08), 0 16px 40px -12px rgb(28 25 23 / 0.3);
        margin: 0;
        border: 1px solid var(--border-strong);
        border-radius: 12px;
        background: var(--surface);
        color: var(--fg);
        box-shadow: var(--lift);
        font: 14px/1.45 var(--font);
        overflow: hidden;
        animation: arrive 160ms ease-out;
      }
      @media (prefers-color-scheme: dark) {
        .card { --lift: 0 1px 2px rgb(0 0 0 / 0.4), 0 16px 40px -12px rgb(0 0 0 / 0.7); }
      }
      @keyframes arrive { from { opacity: 0; transform: translateY(-6px); } }
      @keyframes leave { to { opacity: 0; transform: translateY(-6px); } }
      @media (prefers-reduced-motion: reduce) { .card, .card.closing { animation: none; } }
      .card.closing { animation: leave 160ms ease-in forwards; }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 8px 12px;
        background: var(--subtle);
        border-bottom: 1px solid var(--border);
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .bar.dragging { cursor: grabbing; }
      .mark {
        flex: none;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 5px;
        background: #4f46e5;
      }
      .mark svg { width: 11px; height: 11px; }
      .from {
        flex: 1;
        min-width: 0;
        color: var(--muted);
        font-size: 12.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .grip { flex: none; color: var(--muted); opacity: 0.7; display: flex; }
      .body { padding: 14px 16px 4px; }
      .title { margin: 0 0 4px; font-size: 15px; font-weight: 600; line-height: 1.35; }
      .message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 40vh; overflow-y: auto; }
      .title:not([hidden]) + .message { color: var(--muted); }
      .title[hidden] { display: none; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 16px 16px; }
      .actions[hidden] { display: none; }
      button {
        font: 500 13.5px/1 var(--font);
        padding: 9px 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: transparent;
        color: var(--fg);
        cursor: pointer;
      }
      button:hover { background: var(--subtle); }
      button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
      .confirm { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
      .confirm:hover { background: color-mix(in srgb, var(--accent) 88%, black); border-color: color-mix(in srgb, var(--accent) 88%, black); }
      .done { margin: 0; padding: 14px 16px 16px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
      .done[hidden] { display: none; }
      .done svg { width: 14px; height: 14px; color: var(--ok); }
    </style>
    <section class="card" dir="${content.dir}" role="dialog" aria-modal="false" aria-labelledby="ask-from" aria-describedby="ask-message">
      <div class="bar">
        <span class="mark" aria-hidden="true">
          <svg viewBox="0 0 128 128"><path d="M34 102 L64 26 L94 102 M45 76 H83" fill="none" stroke="#fff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="from" id="ask-from"></span>
        <span class="grip" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="2.5" r="1"/><circle cx="8" cy="2.5" r="1"/><circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/><circle cx="4" cy="9.5" r="1"/><circle cx="8" cy="9.5" r="1"/></svg>
        </span>
      </div>
      <div class="body">
        <h2 class="title" hidden></h2>
        <p class="message" id="ask-message"></p>
      </div>
      <div class="actions">
        <button class="cancel" type="button"></button>
        <button class="confirm" type="button"></button>
      </div>
      <p class="done" role="status" hidden></p>
    </section>`;

  const find = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const card = find<HTMLElement>('.card');
  const bar = find<HTMLElement>('.bar');
  const title = find<HTMLElement>('.title');
  const actions = find<HTMLElement>('.actions');
  const done = find<HTMLElement>('.done');
  const confirm = find<HTMLButtonElement>('.confirm');
  const cancel = find<HTMLButtonElement>('.cancel');

  bar.title = content.dragHint;
  find<HTMLElement>('.from').textContent = content.heading;
  find<HTMLElement>('.message').textContent = content.message;
  if (content.title) {
    title.textContent = content.title;
    title.hidden = false;
  }
  confirm.textContent = content.confirmLabel;
  cancel.textContent = content.cancelLabel;

  const armedAt = performance.now() + armDelayMs;
  const answer = (choice: 'confirmed' | 'cancelled') => (event: MouseEvent) => {
    if (!event.isTrusted || performance.now() < armedAt || state.answer !== 'pending') return;
    state.answer = choice;
    actions.hidden = true;
    done.hidden = false;
    done.innerHTML =
      choice === 'confirmed'
        ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>'
        : '';
    done.append(choice === 'confirmed' ? content.confirmedText : content.cancelledText);
    setTimeout(() => {
      card.classList.add('closing');
      setTimeout(() => host.remove(), 200);
    }, closeDelayMs);
  };
  confirm.addEventListener('click', answer('confirmed'));
  cancel.addEventListener('click', answer('cancelled'));

  const clamp = (value: number, max: number) => Math.min(Math.max(value, edge), Math.max(edge, max - edge));
  let moved = false;
  const place = (left: number, top: number) => {
    const box = host.getBoundingClientRect();
    host.style.setProperty('left', `${clamp(left, window.innerWidth - box.width)}px`, 'important');
    host.style.setProperty('top', `${clamp(top, window.innerHeight - box.height)}px`, 'important');
    host.style.setProperty('right', 'auto', 'important');
    moved = true;
  };
  let grab: { x: number; y: number } | undefined;
  bar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const box = host.getBoundingClientRect();
    grab = { x: event.clientX - box.left, y: event.clientY - box.top };
    bar.setPointerCapture(event.pointerId);
    bar.classList.add('dragging');
    event.preventDefault();
  });
  bar.addEventListener('pointermove', (event) => {
    if (grab) place(event.clientX - grab.x, event.clientY - grab.y);
  });
  const release = () => {
    grab = undefined;
    bar.classList.remove('dragging');
  };
  bar.addEventListener('pointerup', release);
  bar.addEventListener('pointercancel', release);
  window.addEventListener('resize', () => {
    if (!moved) return;
    const box = host.getBoundingClientRect();
    place(box.left, box.top);
  });

  (document.body ?? document.documentElement).append(host);
}

export function readPopover(askId: string): PopoverAnswer {
  const state = (globalThis as unknown as Record<string, { askId: string; answer: PopoverAnswer; host: Element } | undefined>)['__agentBrowserBridgeAsk'];
  if (!state || state.askId !== askId) return 'gone';
  if (state.answer === 'pending' && !state.host.isConnected) return 'gone';
  return state.answer;
}

export function removePopover(askId: string): boolean {
  const state = (globalThis as unknown as Record<string, { askId: string; answer: PopoverAnswer; host: Element } | undefined>)['__agentBrowserBridgeAsk'];
  if (!state || state.askId !== askId) return false;
  const wasShowing = state.host.isConnected;
  if (state.answer === 'pending') state.answer = 'cancelled';
  state.host.remove();
  return wasShowing;
}
