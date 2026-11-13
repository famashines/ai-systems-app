import type { BudgetMonthV1, ModelListItemV1 } from '@famashines/ai-systems-contracts';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import * as api from '@/lib/api';
import { direct } from '@/lib/direct';
import { useSession } from '@/state/session';

export type Load = 'idle' | 'loading' | 'error';
export type Models = { items: ModelListItemV1[]; load: Load; loaded: boolean };
export type Budget = { doc: BudgetMonthV1 | null; load: Load; loaded: boolean };

type Value = { models: Models; reloadModels: () => void; budget: Budget; reloadBudget: () => void };

const noModels: Models = { items: [], load: 'loading', loaded: false };
const noBudget: Budget = { doc: null, load: 'loading', loaded: false };
const DataContext = createContext<Value | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [models, setModels] = useState(noModels);
  const [budget, setBudget] = useState(noBudget);
  const [modelsRun, setModelsRun] = useState(0);
  const [budgetRun, setBudgetRun] = useState(0);
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (status === 'signedOut') direct.forget();
    if (!signedIn) return;
    void direct.load();
    let busy = direct.get().busy;
    const stop = direct.subscribe(() => {
      const now = direct.get().busy;
      if (busy && !now) setBudgetRun((run) => run + 1);
      busy = now;
    });
    return () => {
      stop();
      direct.clear();
      setBudget(noBudget);
    };
  }, [status, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api.listModels().then(
      (items) => live && setModels({ items, load: 'idle', loaded: true }),
      () => live && setModels((now) => ({ ...now, load: 'error' })),
    );
    return () => {
      live = false;
      setModels(noModels);
    };
  }, [signedIn, modelsRun]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api.getBudget().then(
      (doc) => live && setBudget({ doc, load: 'idle', loaded: true }),
      () => live && setBudget((now) => ({ ...now, load: 'error' })),
    );
    return () => {
      live = false;
    };
  }, [signedIn, budgetRun]);

  const value: Value = {
    models,
    reloadModels: () => setModelsRun((run) => run + 1),
    budget,
    reloadBudget: () => {
      setBudget((now) => ({ ...now, load: 'loading' }));
      setBudgetRun((run) => run + 1);
    },
  };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): Value {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData needs a DataProvider');
  return value;
}
