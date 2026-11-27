import { ANALYTICS_ENABLED_KEY } from '../background/analytics.ts';

export const analyticsAvailable = Boolean(import.meta.env.VITE_POSTHOG_KEY);

export function bindAnalyticsToggle(checkbox: HTMLInputElement) {
  const render = (value: unknown) => (checkbox.checked = value !== false);
  void chrome.storage.local.get(ANALYTICS_ENABLED_KEY).then((stored) => render(stored[ANALYTICS_ENABLED_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ANALYTICS_ENABLED_KEY in changes) render(changes[ANALYTICS_ENABLED_KEY].newValue);
  });
  checkbox.addEventListener('change', () => void chrome.storage.local.set({ [ANALYTICS_ENABLED_KEY]: checkbox.checked }));
}
