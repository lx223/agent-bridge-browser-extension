import { INSTANCE_KEY, INSTANCE_NAME_KEY, MAX_INSTANCE_NAME_LENGTH, normalizeInstanceName, saveInstanceName } from '../background/browser.ts';

export function bindInstanceName(input: HTMLInputElement, idLabel: HTMLElement) {
  input.maxLength = MAX_INSTANCE_NAME_LENGTH;

  const renderName = (value: unknown) => {
    if (document.activeElement !== input) input.value = normalizeInstanceName(value) ?? '';
  };
  const renderId = (value: unknown) => {
    idLabel.textContent = typeof value === 'string' && value ? `Instance id: ${value}` : '';
  };

  void chrome.storage.local.get([INSTANCE_NAME_KEY, INSTANCE_KEY]).then((stored) => {
    renderName(stored[INSTANCE_NAME_KEY]);
    renderId(stored[INSTANCE_KEY]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (INSTANCE_NAME_KEY in changes) renderName(changes[INSTANCE_NAME_KEY].newValue);
    if (INSTANCE_KEY in changes) renderId(changes[INSTANCE_KEY].newValue);
  });

  input.addEventListener('change', () => {
    input.value = normalizeInstanceName(input.value) ?? '';
    void saveInstanceName(chrome.storage.local, input.value);
  });
}
