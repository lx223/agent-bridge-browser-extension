import { analyticsAvailable, bindAnalyticsToggle } from '../settings/analyticsToggle.ts';

const PRIVACY_URL = 'https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$<HTMLAnchorElement>('privacy-link').href = PRIVACY_URL;

if (analyticsAvailable) {
  bindAnalyticsToggle($<HTMLInputElement>('analytics-enabled'));
} else {
  $('analytics-setting').hidden = true;
  $('analytics-unavailable').hidden = false;
}
