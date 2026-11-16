import type { GroupColor } from '@agent-browser-bridge/protocol';

/** @types/chrome models colours as an enum; its values are these same strings. */
export const toChromeColor = (color: GroupColor) => color as `${chrome.tabGroups.Color}` as chrome.tabGroups.Color;
