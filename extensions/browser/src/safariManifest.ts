export interface ChromeBackground {
  service_worker: string;
  type?: string;
}

export interface SafariBackground {
  scripts: string[];
  persistent: false;
}

export const SAFARI_EXTRA_PERMISSIONS = ['scripting'];
export const SAFARI_HOST_PERMISSIONS = ['<all_urls>'];

export function safariManifest<M extends { background: ChromeBackground; permissions?: string[] }>(
  manifest: M,
): Omit<M, 'background'> & { background: SafariBackground; permissions: string[]; host_permissions: string[] } {
  const { background, ...rest } = manifest;
  if (background.type === 'module') throw new Error('Safari loads background scripts only as classic scripts, not modules.');
  return {
    ...rest,
    background: { scripts: [background.service_worker], persistent: false },
    permissions: [...new Set([...(manifest.permissions ?? []), ...SAFARI_EXTRA_PERMISSIONS])],
    host_permissions: SAFARI_HOST_PERMISSIONS,
  };
}
