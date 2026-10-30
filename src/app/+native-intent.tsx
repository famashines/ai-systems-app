export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(famashines-ai:\/\/)?\/?auth(\?|$)/.test(path) ? '/' : path;
}
