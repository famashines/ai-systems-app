import * as LocalAuthentication from 'expo-local-authentication';

import { getItem, removeItem, setItem } from '@/lib/cache';

export const lockAfterMs = 5 * 60 * 1000;
export const reloadGraceMs = 30_000;
const reloadKey = 'lock.reloadAt';

export function shouldLock(backgroundAt: number | null, now: number): boolean {
  return backgroundAt !== null && (now < backgroundAt || now - backgroundAt >= lockAfterMs);
}

export async function canLock(): Promise<boolean> {
  return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
}

export async function unlock(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage });
  return result.success;
}

export async function markAppReload(now = Date.now()): Promise<void> {
  await setItem(reloadKey, now);
}

export async function takeAppReload(now = Date.now()): Promise<boolean> {
  const marked = await getItem<number>(reloadKey);
  if (!marked) return false;
  await removeItem(reloadKey);
  return marked.value <= now && now - marked.value < reloadGraceMs;
}
