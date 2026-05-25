declare module "qrcode" {
  export function toString(input: string, options?: Record<string, unknown>): Promise<string>;
}

declare module "ws" {
  import type { IncomingMessage } from "node:http";

  export class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(url: string, options?: { headers?: Record<string, string> });
    on(event: "message", listener: (data: Buffer) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: "open", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    send(data: string, callback?: (error?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }

  export class WebSocketServer {
    constructor(options: { server: unknown; path?: string });
    on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    close(callback?: () => void): void;
  }

  export default WebSocket;
}
