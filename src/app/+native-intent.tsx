export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(com\.famashines\.ai:\/*|exp:\/\/[^/]+\/--\/|\/--\/)?\/?oauth2redirect(\?|$)/.test(path) ? '/' : path;
}
