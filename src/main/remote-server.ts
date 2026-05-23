/**
 * Remote HTTP + WebSocket server for mobile access.
 * Mirrors the IPC API with token-based auth.
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";
import { SessionStore } from "../core/session-store.ts";
import { Engine } from "./engine";
import { listCronJobs, applyCronUpdate, deleteCronJob, cronStorePathFromRoot } from "../core/tools/cron.ts";
import { MagiPaths } from "../core/paths.ts";
import { getMobileUI } from "./remote-ui";

export interface RemoteServerDeps {
  store: SessionStore;
  engine: Engine;
  paths: MagiPaths;
}

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let token: string | null = null;
let clients: Set<WebSocket> = new Set();

export function getToken(): string | null { return token; }
export function isRunning(): boolean { return server !== null; }
export function getConnectedClients(): number { return clients.size; }

export function broadcast(data: any): void {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function startRemoteServer(deps: RemoteServerDeps, port = 3777): Promise<number> {
  if (server) return Promise.resolve(port);

  token = randomBytes(32).toString("hex");
  const { store, engine, paths } = deps;
  const cronPath = cronStorePathFromRoot(paths.stateRoot);

  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const reqToken = url.searchParams.get("token") || req.headers.authorization?.replace("Bearer ", "");

      // Auth check (skip for favicon)
      if (url.pathname !== "/favicon.ico" && reqToken !== token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      route(req, res, url, { store, engine, cronPath });
    });

    wss = new WebSocketServer({ server: srv, path: "/ws" });
    wss.on("connection", (ws, req) => {
      const wsUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (wsUrl.searchParams.get("token") !== token) {
        ws.close(4001, "Unauthorized");
        return;
      }
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
    });

    srv.on("error", reject);
    srv.listen(port, "0.0.0.0", () => {
      server = srv;
      resolve(port);
    });
  });
}

export function stopRemoteServer(): void {
  for (const ws of clients) ws.close();
  clients.clear();
  wss?.close();
  wss = null;
  server?.close();
  server = null;
  token = null;
}

// ── Routing ──

function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: { store: SessionStore; engine: Engine; cronPath: string }
) {
  const { pathname } = url;
  const method = req.method ?? "GET";

  // Mobile UI
  if (pathname === "/" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getMobileUI(token!));
    return;
  }

  // Status
  if (pathname === "/api/status" && method === "GET") {
    json(res, { running: ctx.engine.running, sessionId: ctx.engine.sessionId });
    return;
  }

  // Chat
  if (pathname === "/api/chat" && method === "POST") {
    readBody(req).then(async (body) => {
      const { sessionId, text } = JSON.parse(body);
      if (!sessionId || !text) { json(res, { error: "Missing sessionId or text" }, 400); return; }
      // Save user message
      if (!ctx.store.getSession(sessionId)) {
        ctx.store.createSession({ id: sessionId, title: text.slice(0, 80), cwd: ctx.engine.cwd });
      }
      ctx.store.appendMessage({ sessionId, role: "user", content: JSON.stringify({ type: "text", text }), metadata: {} });
      json(res, { ok: true });
      // Start query (results stream via WebSocket)
      await ctx.engine.startQuery(sessionId, text);
    }).catch((e) => json(res, { error: e.message }, 500));
    return;
  }

  // File upload — saves to workspace's uploads/ subdirectory
  if (pathname === "/api/upload" && method === "POST") {
    const filename = url.searchParams.get("name") || `upload-${Date.now()}`;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadDir = path.join(ctx.engine.cwd, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, safeName);
    const stream = fs.createWriteStream(filePath);
    req.pipe(stream);
    stream.on("finish", () => {
      json(res, { ok: true, path: filePath, name: safeName });
    });
    stream.on("error", (e) => json(res, { error: e.message }, 500));
    return;
  }

  // Sessions
  if (pathname === "/api/sessions" && method === "GET") {
    json(res, ctx.store.listSessions(50));
    return;
  }
  if (pathname === "/api/sessions" && method === "POST") {
    readBody(req).then((body) => {
      const { title } = JSON.parse(body);
      const id = ctx.store.createSession({ title: title ?? "Remote", cwd: ctx.engine.cwd });
      json(res, { id });
    }).catch((e) => json(res, { error: e.message }, 500));
    return;
  }

  // Tasks
  if (pathname === "/api/tasks" && method === "GET") {
    try { json(res, listCronJobs(ctx.cronPath)); } catch { json(res, []); }
    return;
  }
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(pause|resume)$/);
  if (taskMatch && method === "POST") {
    const [, id, action] = taskMatch;
    applyCronUpdate(ctx.cronPath, { id, enabled: action === "resume" });
    json(res, { ok: true });
    return;
  }
  const taskDelMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskDelMatch && method === "DELETE") {
    deleteCronJob(ctx.cronPath, taskDelMatch[1]);
    json(res, { ok: true });
    return;
  }

  // Task history
  if (pathname === "/api/tasks/history" && method === "GET") {
    json(res, ctx.store.listAgentTasks(50));
    return;
  }

  // 404
  json(res, { error: "Not found" }, 404);
}

function json(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
