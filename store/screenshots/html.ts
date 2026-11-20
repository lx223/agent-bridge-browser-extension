const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => entities[char]!);

export const pngDataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
