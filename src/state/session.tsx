import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import * as auth from '@/lib/auth';
import { canLock, shouldLock, unlock } from '@/lib/lock';

export type Status = 'loading' | 'signedOut' | 'signedIn';

type Value = {
  status: Status;
  locked: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  unlock: (prompt: string) => Promise<boolean>;
};

const SessionContext = createContext<Value | null>(null);

async function lockIfPossible(lock: () => void): Promise<void> {
  if (await canLock().catch(() => false)) lock();
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [locked, setLocked] = useState(false);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    auth.onSessionEnded(() => {
      setLocked(false);
      setStatus('signedOut');
    });
    void (async () => {
      const signedIn = await auth.restore().catch(() => false);
      if (signedIn) await lockIfPossible(() => setLocked(true));
      setStatus(signedIn ? 'signedIn' : 'signedOut');
    })();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state !== 'active') return;
      const due = shouldLock(backgroundAt.current, Date.now());
      backgroundAt.current = null;
      if (due && status === 'signedIn') void lockIfPossible(() => setLocked(true));
    });
    return () => subscription.remove();
  }, [status]);

  const value: Value = {
    status,
    locked,
    signIn: async () => {
      if (await auth.signIn()) setStatus('signedIn');
    },
    signOut: async () => {
      await auth.signOut();
      setLocked(false);
      setStatus('signedOut');
    },
    unlock: async (prompt) => {
      const ok = await unlock(prompt).catch(() => false);
      if (ok) setLocked(false);
      return ok;
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Value {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession needs a SessionProvider');
  return value;
}
