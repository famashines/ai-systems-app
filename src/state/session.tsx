import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import * as auth from '@/lib/auth';
import { canLock, shouldLock, takeAppReload, unlock } from '@/lib/lock';

export type Status = 'loading' | 'signedOut' | 'signedIn';

type Value = {
  status: Status;
  locked: boolean;
  deviceSecure: boolean;
  ended: 'refused' | 'expired' | null;
  signIn: () => Promise<void>;
  signOut: (reason?: 'refused') => Promise<void>;
  unlock: (prompt: string) => Promise<boolean>;
};

const SessionContext = createContext<Value | null>(null);

function canLockOrTrue(): Promise<boolean> {
  return canLock().catch(() => true);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [locked, setLocked] = useState(false);
  const [deviceSecure, setDeviceSecure] = useState(true);
  const [ended, setEnded] = useState<'refused' | 'expired' | null>(null);
  const lockable = useRef(true);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    auth.onSessionEnded(() => {
      setEnded('expired');
      setLocked(false);
      setStatus('signedOut');
    });
    void (async () => {
      const [signedIn, secure, reloaded] = await Promise.all([
        auth.restore().catch(() => false),
        canLockOrTrue(),
        takeAppReload().catch(() => false),
      ]);
      lockable.current = secure;
      setDeviceSecure(secure);
      if (signedIn && secure && !reloaded) setLocked(true);
      setStatus(signedIn ? 'signedIn' : 'signedOut');
    })();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state !== 'active') return;
      const due = shouldLock(backgroundAt.current, Date.now());
      backgroundAt.current = null;
      if (due && status === 'signedIn' && lockable.current) setLocked(true);
      void canLockOrTrue().then((secure) => {
        lockable.current = secure;
        setDeviceSecure(secure);
      });
    });
    return () => subscription.remove();
  }, [status]);

  const value: Value = {
    status,
    locked,
    deviceSecure,
    ended,
    signIn: async () => {
      setEnded(null);
      if (await auth.signIn()) setStatus('signedIn');
    },
    signOut: async (reason) => {
      setEnded(reason ?? null);
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
