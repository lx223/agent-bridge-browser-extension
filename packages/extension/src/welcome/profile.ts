export const profileInitial = (name: string): string => [...name.trim()][0]?.toLocaleUpperCase() ?? '';
