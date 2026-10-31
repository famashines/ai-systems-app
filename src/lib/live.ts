import { ClientMessageV1, ServerMessageV1, WsCloseCode, WsLimits, type Topic } from '@famashines/ai-systems-contracts';

import { backoffMs } from '@/lib/api';

export const tryAgainLater = 1013;

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';
export type Notice = Extract<ServerMessageV1, { type: 'notice' }>;

export type LiveOptions = {
  url: string;
  topics: Topic[];
  lastSeq: number | null;
  getToken: () => Promise<string | null>;
  refresh: () => Promise<boolean>;
  onStatus: (status: LiveStatus) => void;
  onSubscribed: (snapshot: boolean, lastSeq: number) => void;
  onNotice: (notice: Notice) => void;
  onAuthLost: () => void;
};

export class LiveClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private beat: ReturnType<typeof setInterval> | undefined;
  private heartbeatMs: number = WsLimits.pingIntervalMs;
  private stopped = true;
  private subscribed = false;
  private connected = false;
  lastSeq: number | null;

  constructor(private readonly options: LiveOptions) {
    this.lastSeq = options.lastSeq;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.halt();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.options.onStatus('stopped');
  }

  reauth(token: string): void {
    if (this.subscribed) this.send({ type: 'reauth', token });
  }

  wake(): void {
    if (this.stopped) return;
    if (!this.subscribed) {
      if (this.ws) return;
      this.halt();
      this.attempts = 0;
      void this.connect();
      return;
    }
    this.ping();
  }

  private ping(): void {
    this.send({ type: 'ping', t: Date.now() });
    if (this.pongTimer === undefined) this.pongTimer = setTimeout(() => this.drop(), WsLimits.pongTimeoutMs);
  }

  private halt(): void {
    clearTimeout(this.timer);
    clearTimeout(this.pongTimer);
    clearInterval(this.beat);
    this.pongTimer = undefined;
    this.subscribed = false;
  }

  private send(message: ClientMessageV1): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ClientMessageV1.parse(message)));
  }

  private async connect(): Promise<void> {
    this.options.onStatus(this.connected ? 'reconnecting' : 'connecting');
    let token: string | null;
    try {
      token = await this.options.getToken();
    } catch {
      this.retry();
      return;
    }
    if (this.stopped) return;
    if (!token) {
      this.authLost();
      return;
    }
    const ws = new WebSocket(this.options.url);
    this.ws = ws;
    ws.onopen = () => this.send({ type: 'hello', v: 1, token, ...(this.lastSeq === null ? {} : { lastSeq: this.lastSeq }) });
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
    let parsed: ReturnType<typeof ServerMessageV1.safeParse>;
    try {
      parsed = ServerMessageV1.safeParse(JSON.parse(String(data)));
    } catch {
      this.drop();
      return;
    }
    if (!parsed.success) {
      this.drop();
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case 'welcome':
        this.attempts = 0;
        this.heartbeatMs = message.heartbeatMs;
        this.send({ type: 'subscribe', topics: this.options.topics });
        return;
      case 'resync':
        this.lastSeq = null;
        return;
      case 'subscribed': {
        const snapshot = this.lastSeq === null || message.fromSeq > this.lastSeq + 1;
        if (this.lastSeq === null) this.lastSeq = Math.max(message.fromSeq - 1, 0);
        this.subscribed = true;
        this.connected = true;
        clearInterval(this.beat);
        this.beat = setInterval(() => this.ping(), this.heartbeatMs);
        this.options.onStatus('live');
        this.options.onSubscribed(snapshot, this.lastSeq);
        return;
      }
      case 'notice':
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
        return;
      default:
        return;
    }
  }

  private drop(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    void this.closed(1006);
  }

  private async closed(code: number): Promise<void> {
    const resume = this.attempts === 0;
    this.halt();
    if (this.stopped) return;
    if (code === WsCloseCode.auth) {
      this.options.onStatus('reconnecting');
      let renewed: boolean;
      try {
        renewed = await this.options.refresh();
      } catch {
        this.retry();
        return;
      }
      if (this.stopped) return;
      if (renewed) this.retry(resume ? 0 : undefined);
      else this.authLost();
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
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  private authLost(): void {
    this.stopped = true;
    this.halt();
    this.options.onStatus('stopped');
    this.options.onAuthLost();
  }
}
