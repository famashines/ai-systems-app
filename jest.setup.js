jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('expo-sqlite', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  return {
    openDatabaseSync: () => {
      const db = new DatabaseSync(':memory:');
      return {
        execSync: (sql) => db.exec(sql),
        getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
        runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
      };
    },
  };
});

jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

jest.mock('expo-localization', () => ({
  useLocales: jest.fn(() => [{ languageCode: 'en' }]),
}));
