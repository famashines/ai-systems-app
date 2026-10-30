import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

export type Cached<T> = { value: T; updatedAt: number };

let db: SQLiteDatabase | null = null;

function open(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync('cache.db');
    db.execSync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  }
  return db;
}

export async function getItem<T>(key: string): Promise<Cached<T> | null> {
  const row = await open().getFirstAsync<{ value: string; updated_at: number }>('SELECT value, updated_at FROM kv WHERE key = ?', key);
  return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null;
}

export async function setItem<T>(key: string, value: T, now = Date.now()): Promise<void> {
  await open().runAsync('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now);
}

export async function removeItem(key: string): Promise<void> {
  await open().runAsync('DELETE FROM kv WHERE key = ?', key);
}
