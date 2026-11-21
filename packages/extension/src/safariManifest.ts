export interface ChromeBackground {
  service_worker: string;
  type?: string;
}

export interface SafariBackground {
  scripts: string[];
  persistent: false;
}

export function safariManifest<M extends { background: ChromeBackground }>(manifest: M): Omit<M, 'background'> & { background: SafariBackground } {
  const { background, ...rest } = manifest;
  if (background.type === 'module') throw new Error('Safari loads background scripts only as classic scripts, not modules.');
  return { ...rest, background: { scripts: [background.service_worker], persistent: false } };
}
