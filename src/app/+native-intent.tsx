export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(com\.famashines\.ai:\/*)?\/?oauth2redirect(\?|$)/.test(path) ? '/' : path;
}
