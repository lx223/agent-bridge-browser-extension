import { slotMarkers, splitAroundSlots, t, uiLocale, type MessageKey } from './messages.ts';

const ATTRIBUTES = ['placeholder', 'aria-label', 'title'];

function localizeText(element: HTMLElement, key: MessageKey) {
  const children = [...element.children];
  const literal = element.dataset.i18nArg;
  const message = literal === undefined ? t(key, ...slotMarkers(children.length)) : t(key, literal);
  if (!message) return;
  if (literal !== undefined || !children.length) {
    element.textContent = message;
    return;
  }
  element.replaceChildren(...splitAroundSlots(message, children.length).map((part) => (typeof part === 'number' ? children[part]! : part)));
}

export function localizePage(root: Document = document) {
  root.documentElement.lang = uiLocale();
  root.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) localizeText(element, element.dataset.i18n as MessageKey);
  for (const attribute of ATTRIBUTES) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      const message = t(element.getAttribute(`data-i18n-${attribute}`) as MessageKey);
      if (message) element.setAttribute(attribute, message);
    }
  }
}
