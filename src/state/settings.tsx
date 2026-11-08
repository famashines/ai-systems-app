import type { ReasoningEffort } from '@famashines/ai-systems-contracts';
import { reloadAppAsync } from 'expo';
import { useLocales } from 'expo-localization';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { I18nManager, useColorScheme } from 'react-native';

import { isRTL, pickLanguage, translate, type Key, type Language, type Params } from '@/i18n';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { markAppReload } from '@/lib/lock';
import { useSession } from '@/state/session';
import { darkColors, lightColors, type Colors } from '@/theme';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type LanguageChoice = Language | 'system';
export type Settings = { language: LanguageChoice; theme: ThemeChoice; model: string | null; effort: ReasoningEffort | null };

const settingsKey = 'settings';
const reloadKey = 'rtlReload';
const defaults: Settings = { language: 'system', theme: 'system', model: null, effort: null };

type Value = {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
  language: Language;
  t: (key: Key, params?: Params) => string;
  colors: Colors;
  dark: boolean;
};

const SettingsContext = createContext<Value | null>(null);

export async function applyDirection(language: Language, chosenInApp = false): Promise<void> {
  const rtl = isRTL(language);
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  if (I18nManager.isRTL === rtl) return removeItem(reloadKey);
  if ((await getItem<boolean>(reloadKey))?.value === rtl) return;
  await setItem(reloadKey, rtl);
  if (chosenInApp) await markAppReload();
  await reloadAppAsync('Layout direction changed');
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { locked } = useSession();
  const chosenInApp = useRef(false);
  const scheme = useColorScheme();
  const deviceLanguage = pickLanguage(useLocales()[0]?.languageCode);
  const choice = settings?.language ?? 'system';
  const language = choice === 'system' ? deviceLanguage : choice;

  useEffect(() => {
    getItem<Settings>(settingsKey)
      .then((cached) => setSettings({ ...defaults, ...cached?.value }))
      .catch(() => setSettings(defaults));
  }, []);

  useEffect(() => {
    if (!settings) return;
    const chosen = chosenInApp.current;
    chosenInApp.current = false;
    void applyDirection(language, chosen).catch(() => {});
  }, [settings, language]);

  if (!settings) return null;

  const dark = settings.theme === 'system' ? scheme === 'dark' : settings.theme === 'dark';
  const value: Value = {
    settings,
    update: async (patch) => {
      const next = { ...settings, ...patch };
      if (next.language !== settings.language) chosenInApp.current = !locked;
      setSettings(next);
      await setItem(settingsKey, next);
    },
    language,
    t: (key, params) => translate(language, key, params),
    colors: dark ? darkColors : lightColors,
    dark,
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Value {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings needs a SettingsProvider');
  return value;
}
