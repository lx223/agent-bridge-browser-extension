import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, pngDataUri } from './html.ts';
import type { Caption } from './locale.ts';

export const FRAME = { width: 1280, height: 800 };
export const STAGE = { width: 1120, height: 520 };
const STAGE_TOP = 240;
const TITLE_BAR = 36;
const CHAT_WIDTH = 400;
const GAP = 24;

export const FULL_WINDOW = { width: STAGE.width, height: STAGE.height - TITLE_BAR };
export const SIDE_WINDOW = { width: STAGE.width - CHAT_WIDTH - GAP, height: STAGE.height - TITLE_BAR };

export interface Size {
  width: number;
  height: number;
}

export const scaled = (size: Size, factor: number): Size => ({ width: Math.round(size.width * factor), height: Math.round(size.height * factor) });

const ICON = readFileSync(join(import.meta.dirname, '../../packages/extension/icons/icon.svg'));
const iconUri = `data:image/svg+xml;base64,${ICON.toString('base64')}`;

const groupColors: Record<string, string> = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#e37400',
  green: '#188038',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#007b83',
  orange: '#fa903e',
};

export type ChatMessage = { kind: 'user' | 'agent'; text: string } | { kind: 'tool'; name: string; detail?: string };

export interface ChatLabels {
  you: string;
  agent: string;
}

export interface TabGroupView {
  title: string;
  color: string;
  tabs: string[];
}

const styles = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    width: ${FRAME.width}px; height: ${FRAME.height}px; overflow: hidden;
    font-family: system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK JP', 'Noto Sans CJK SC', sans-serif;
    color: #0f172a;
    background: radial-gradient(1200px 600px at 85% -10%, #818cf8 0%, rgba(129, 140, 248, 0) 60%), linear-gradient(160deg, #4f46e5 0%, #312e81 100%);
  }
  .frame { position: relative; height: 100%; }
  header { position: absolute; left: 80px; right: 80px; top: 0; height: ${STAGE_TOP}px; display: flex; gap: 22px; align-items: center; }
  header img { width: 60px; height: 60px; flex: none; border-radius: 14px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.35); }
  .caption { min-width: 0; flex: 1; }
  h1 { margin: 0; color: #fff; font-size: 42px; line-height: 1.15; font-weight: 700; letter-spacing: -0.01em; max-height: 97px; overflow: hidden; }
  .subline { margin: 12px 0 0; color: #e0e7ff; font-size: 21px; line-height: 1.4; max-height: 59px; overflow: hidden; }
  .stage { position: absolute; left: 80px; top: ${STAGE_TOP}px; width: ${STAGE.width}px; height: ${STAGE.height}px; display: flex; gap: ${GAP}px; }

  .window { flex: none; height: 100%; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.45); display: flex; flex-direction: column; }
  .bar { height: ${TITLE_BAR}px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #eef0f4; border-bottom: 1px solid #dfe3ea; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #d1d5db; }
  .bar i:nth-child(1) { background: #f87171; }
  .bar i:nth-child(2) { background: #fbbf24; }
  .bar i:nth-child(3) { background: #34d399; }
  .bar span { margin-left: 10px; font-size: 13px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body { flex: 1; position: relative; overflow: hidden; }
  .body > img { display: block; }

  .chat { width: ${CHAT_WIDTH}px; flex: none; height: 100%; background: #0f172a; color: #e2e8f0; border-radius: 14px; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.45); padding: 22px 22px; display: flex; flex-direction: column; gap: 14px; overflow: hidden; }
  .who { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; }
  .user { align-self: flex-end; max-width: 92%; }
  .user .who { text-align: right; }
  .user p { margin: 0; background: #4f46e5; color: #fff; padding: 11px 14px; border-radius: 14px 14px 4px 14px; font-size: 16px; line-height: 1.45; }
  .agent p { margin: 0; background: #1e293b; padding: 11px 14px; border-radius: 14px 14px 14px 4px; font-size: 16px; line-height: 1.45; }
  .tool { font: 13px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: #a5b4fc; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(129, 140, 248, 0.3); border-radius: 8px; padding: 7px 10px; }
  .tool b { color: #c7d2fe; font-weight: 600; }
  .tool small { display: block; color: #94a3b8; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .groups { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; background: #f8fafc; height: 100%; }
  .strip { display: flex; gap: 8px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0; }
  .chip { color: #fff; font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 8px; white-space: nowrap; }
  .group { border-left: 4px solid; padding-left: 14px; }
  .group h3 { margin: 0 0 6px; font-size: 15px; }
  .group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .group li { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #334155; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group li i { flex: none; width: 18px; height: 18px; border-radius: 5px; color: #fff; font: 600 11px/18px system-ui, sans-serif; text-align: center; font-style: normal; }

  .center { height: 100%; display: flex; align-items: center; justify-content: center; background: #e9ecf2; }
  .popup { border-radius: 10px; overflow: hidden; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22); background: #fff; }
`;

export function windowCard(options: { title?: string; size: Size; body: string }) {
  const title = options.title ? `<span>${escapeHtml(options.title)}</span>` : '';
  return `<section class="window" style="width: ${options.size.width}px"><div class="bar"><i></i><i></i><i></i>${title}</div><div class="body">${options.body}</div></section>`;
}

export const screenshotBody = (png: Buffer, size: Size) =>
  `<img src="${pngDataUri(png)}" width="${size.width}" height="${size.height}" alt="" />`;

export const popupBody = (png: Buffer, size: Size) =>
  `<div class="center"><div class="popup">${screenshotBody(png, size)}</div></div>`;

export function chatCard(labels: ChatLabels, messages: ChatMessage[]) {
  const items = messages.map((message) => {
    if (message.kind === 'tool') {
      const detail = message.detail ? `<small>${escapeHtml(message.detail)}</small>` : '';
      return `<div class="tool"><b>${escapeHtml(message.name)}</b>${detail}</div>`;
    }
    const who = message.kind === 'user' ? labels.you : labels.agent;
    return `<div class="${message.kind}"><div class="who">${escapeHtml(who)}</div><p>${escapeHtml(message.text)}</p></div>`;
  });
  return `<section class="chat" data-fit>${items.join('')}</section>`;
}

export function tabGroupsBody(groups: TabGroupView[]) {
  const colorOf = (group: TabGroupView) => groupColors[group.color] ?? groupColors.grey;
  const chips = groups.map((group) => `<span class="chip" style="background: ${colorOf(group)}">${escapeHtml(group.title)} · ${group.tabs.length}</span>`);
  const sections = groups.map((group) => {
    const tabs = group.tabs.map((title) => `<li><i style="background: ${colorOf(group)}">${escapeHtml([...title][0] ?? '')}</i>${escapeHtml(title)}</li>`);
    return `<div class="group" style="border-color: ${colorOf(group)}"><h3 style="color: ${colorOf(group)}">${escapeHtml(group.title)}</h3><ul>${tabs.join('')}</ul></div>`;
  });
  return `<div class="groups" data-fit><div class="strip">${chips.join('')}</div>${sections.join('')}</div>`;
}

export function frameHtml(options: { languageTag: string; caption: Caption; stage: string }) {
  return `<!doctype html>
<html lang="${options.languageTag}">
  <head><meta charset="utf-8" /><style>${styles}</style></head>
  <body>
    <div class="frame">
      <header>
        <img src="${iconUri}" alt="" />
        <div class="caption">
          <h1 data-fit>${escapeHtml(options.caption.headline)}</h1>
          <p class="subline" data-fit>${escapeHtml(options.caption.subline)}</p>
        </div>
      </header>
      <div class="stage">${options.stage}</div>
    </div>
  </body>
</html>`;
}
