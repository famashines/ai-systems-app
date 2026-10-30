import { getItem, removeItem, setItem } from '@/lib/cache';

it('returns null for a key that is not stored', async () => {
  expect(await getItem('missing')).toBeNull();
});

it('keeps a typed value with the time of the write', async () => {
  await setItem('tasks', [{ id: 't1', title: 'Plan' }], 1000);
  const cached = await getItem<{ id: string; title: string }[]>('tasks');
  expect(cached).toEqual({ value: [{ id: 't1', title: 'Plan' }], updatedAt: 1000 });
});

it('replaces a value and removes it', async () => {
  await setItem('theme', 'light', 1);
  await setItem('theme', 'dark', 2);
  expect(await getItem('theme')).toEqual({ value: 'dark', updatedAt: 2 });
  await removeItem('theme');
  expect(await getItem('theme')).toBeNull();
});
