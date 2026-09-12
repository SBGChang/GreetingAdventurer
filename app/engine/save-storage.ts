// Browser Storage.setItem replaces one value atomically. Electron persists this origin in userData.
// Storage errors propagate to the UI; an unreadable primary slot is never silently overwritten.
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const primary = 'greeting-adventurer.save.v1';
const backup = 'greeting-adventurer.save.v1.backup';
export function readSave(storage: SaveStorage, fromBackup = false): string | undefined {
  return storage.getItem(fromBackup ? backup : primary) ?? undefined;
}
export function writeSave(storage: SaveStorage, text: string): void {
  const previous = storage.getItem(primary);
  if (previous !== null) storage.setItem(backup, previous);
  storage.setItem(primary, text);
}

export function restoreSave(storage: SaveStorage, validatedBackup: string): void {
  // Keep the known-good backup intact even if restoring the primary fails.
  storage.setItem(primary, validatedBackup);
}
