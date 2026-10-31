import { ClientMessageV1, ServerMessageV1, WsCloseCode, WsLimits, type Topic } from '@famashines/ai-systems-contracts';

import { backoffMs } from '@/lib/api';

export const tryAgainLater = 1013;
export const stableAfterMs = 10_000;
export const minHeartbeatMs = 5_000;
export const refusedLimit = 3;
export const refusedWindowMs = 60_000;

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';
export type Notice = Extract<ServerMessageV1, { type: 'notice' }>;
export type AuthLost = 'expired' | 'refused';

export type LiveOptions = {
  url: string;
  topics: Topic[];
  lastSeq: number | null;
  getToken: () => Promise<string | null>;
  refresh: () => Promise<boolean>;
  onStatus: (status: LiveStatus) => void;
  onSubscribed: (snapshot: boolean, lastSeq: number) => void;
  onResync: () => void;
  onNotice: (notice: Notice) => void;
  onAuthLost: (reason: AuthLost) => void;
};

export class LiveClient {
  private ws: WebSocket | null = null;
  private generation = 0;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private stableTimer: ReturnType<typeof setTimeout> | undefined;
  private beat: ReturnType<typeof setInterval> | undefined;
  private heartbeatMs: number = WsLimits.pingIntervalMs;
  private token: string | null = null;
  private refused: number[] = [];
  private stopped = true;
  private subscribed = false;
  private connected = false;
  lastSeq: number | null;
  invalidFrames = 0;

  constructor(private readonly options: LiveOptions) {
    this.lastSeq = options.lastSeq || null;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.halt();
    this.replace(null);
    this.options.onStatus('stopped');
  }

  reauth(token: string): void {
    this.token = token;
    this.send({ type: 'reauth', token });
  }

  wake(): void {
    if (this.stopped) return;
    if (this.subscribed) {
      this.ping();
      return;
    }
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.connect();
  }

  private ping(): void {
    this.send({ type: 'ping', t: Date.now() });
    this.pongTimer ??= setTimeout(() => this.lost(), WsLimits.pongTimeoutMs);
  }

  private halt(): void {
    clearTimeout(this.timer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.stableTimer);
    clearInterval(this.beat);
    this.timer = undefined;
    this.pongTimer = undefined;
    this.subscribed = false;
  }

  private replace(ws: WebSocket | null): void {
    const old = this.ws;
    this.ws = ws;
    if (old && old !== ws) old.close(1000);
  }

  private send(message: ClientMessageV1, ws = this.ws): void {
    if (ws && ws === this.ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ClientMessageV1.parse(message)));
  }

  private stable(): void {
    clearTimeout(this.stableTimer);
    this.attempts = 0;
    this.refused = [];
  }

  private async connect(): Promise<void> {
    const mine = ++this.generation;
    this.replace(null);
    this.options.onStatus(this.connected ? 'reconnecting' : 'connecting');
    let token: string | null;
    try {
      token = await this.options.getToken();
    } catch {
      if (mine === this.generation) this.retry();
      return;
    }
    if (mine !== this.generation || this.stopped) return;
    if (!token) {
      this.authLost('expired');
      return;
    }
    this.token = token;
    const ws = new WebSocket(this.options.url);
    this.replace(ws);
    ws.onopen = () => {
      if (this.ws !== ws || !this.token) return;
      this.send({ type: 'hello', v: 1, token: this.token, ...(this.lastSeq ? { lastSeq: this.lastSeq } : {}) }, ws);
    };
    ws.onmessage = (event) => {
      if (this.ws === ws) this.receive(event.data);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      void this.closed(event.code);
    };
  }

  private receive(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      raw = null;
    }
    const parsed = ServerMessageV1.safeParse(raw);
    if (!parsed.success) {
      this.invalidFrames += 1;
      if (this.subscribed && (raw as { type?: unknown } | null)?.type === 'notice') this.options.onResync();
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case 'welcome':
        this.heartbeatMs = Math.max(message.heartbeatMs, minHeartbeatMs);
        this.send({ type: 'subscribe', topics: this.options.topics });
        return;
      case 'resync':
        this.lastSeq = null;
        if (this.subscribed) this.options.onResync();
        return;
      case 'subscribed': {
        const snapshot = !this.lastSeq || message.fromSeq > this.lastSeq + 1;
        if (!this.lastSeq) this.lastSeq = Math.max(message.fromSeq - 1, 0);
        this.subscribed = true;
        this.connected = true;
        clearInterval(this.beat);
        this.beat = setInterval(() => this.ping(), this.heartbeatMs);
        clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => this.stable(), stableAfterMs);
        this.options.onStatus('live');
        this.options.onSubscribed(snapshot, this.lastSeq);
        return;
      }
      case 'notice':
        if (this.subscribed) this.stable();
        if (this.lastSeq !== null && message.seq <= this.lastSeq) return;
        this.lastSeq = message.seq;
        this.options.onNotice(message);
        return;
      case 'ping':
        this.send({ type: 'pong', t: message.t });
        return;
      case 'pong':
        clearTimeout(this.pongTimer);
        this.pongTimer = undefined;
        if (this.subscribed) this.stable();
        return;
      default:
        return;
    }
  }

  private lost(): void {
    this.replace(null);
    void this.closed(1006);
  }

  private async closed(code: number): Promise<void> {
    const resume = this.attempts === 0;
    const mine = ++this.generation;
    this.halt();
    if (this.stopped) return;
    if (code === WsCloseCode.auth) {
      const now = Date.now();
      this.refused = [...this.refused.filter((at) => now - at < refusedWindowMs), now];
      if (this.refused.length >= refusedLimit) {
        this.authLost('refused');
        return;
      }
      this.options.onStatus('reconnecting');
      let renewed: boolean;
      try {
        renewed = await this.options.refresh();
      } catch {
        if (mine === this.generation) this.retry();
        return;
      }
      if (mine !== this.generation || this.stopped) return;
      if (renewed) this.retry(resume ? 0 : undefined);
      else this.authLost('expired');
      return;
    }
    this.retry(code === WsCloseCode.serverRestart && resume ? 0 : undefined);
  }

  private retry(delay = backoffMs(this.attempts)): void {
    if (this.stopped) return;
    this.attempts += 1;
    this.connected = true;
    this.options.onStatus('reconnecting');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.connect();
    }, delay);
  }

  private authLost(reason: AuthLost): void {
    this.stopped = true;
    this.generation += 1;
    this.halt();
    this.replace(null);
    this.options.onStatus('stopped');
    this.options.onAuthLost(reason);
  }
}
