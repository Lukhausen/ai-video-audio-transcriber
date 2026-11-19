export function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeSetting(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Settings are optional when browser storage is restricted.
  }
}
