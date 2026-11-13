export type FakeRequest = { method: string; path: string; query: URLSearchParams; headers: Headers; body: unknown };
type Answer = Response | Error | ((request: FakeRequest) => Response | Promise<Response>);

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function fakeServer(origin: string) {
  const requests: FakeRequest[] = [];
  const answers = new Map<string, Answer[]>();
  const fixed = new Map<string, (request: FakeRequest) => Response>();
  global.fetch = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const request: FakeRequest = {
      method: init.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    if (url.origin !== origin) throw new TypeError(`Network request failed: ${url}`);
    const route = `${request.method} ${request.path}`;
    const answer = answers.get(route)?.shift() ?? fixed.get(route);
    if (!answer) throw new TypeError(`Network request failed: ${url}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(request) : answer;
  }) as typeof fetch;
  return {
    requests,
    on(route: string, ...list: Answer[]) {
      answers.set(route, [...(answers.get(route) ?? []), ...list]);
    },
    always(route: string, answer: (request: FakeRequest) => Response) {
      fixed.set(route, answer);
    },
  };
}
