const parseVersion = (version: string): number[] | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1, 4).map(Number) : undefined;
};

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}
