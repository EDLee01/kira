/**
 * Mobile Web UI — single HTML string served by remote-server.
 * Inline CSS + JS, no external dependencies.
 */
export function getMobileUI(token: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Kira Remote</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root { --bg: #0a0a0f; --surface: #12121a; --border: #1e1e32; --fg: #e8e8f0; --fg2: #6b6b8d; --accent: #6c5ce7; --error: #ef5350; }
html, body { height: 100%; overflow: hidden; }
body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); font-size: 15px; }
.app { display: flex; flex-direction: column; height: 100%; }
.header { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--surface); display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 16px; font-weight: 600; }
.header-right { display: flex; align-items: center; gap: 10px; }
.new-chat-btn { background: none; border: 1px solid var(--border); color: var(--fg2); font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.new-chat-btn:hover { border-color: var(--accent); color: var(--fg); }
.status { font-size: 12px; color: var(--fg2); display: flex; align-items: center; gap: 6px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #27c93f; }
.status-dot.off { background: var(--error); }
.tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); }
.tab { flex: 1; padding: 10px; text-align: center; font-size: 13px; color: var(--fg2); border: none; background: none; cursor: pointer; border-bottom: 2px solid transparent; }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.view { flex: 1; overflow-y: auto; display: none; flex-direction: column; }
.view.active { display: flex; }
.messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6; word-break: break-word; animation: fadeIn 0.2s; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
.msg-user { background: var(--accent); color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
.msg-ai { background: var(--surface); border: 1px solid var(--border); align-self: flex-start; border-bottom-left-radius: 4px; }
.msg-error { background: rgba(239,83,80,0.1); color: var(--error); align-self: center; font-size: 12px; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p { margin: 6px 0; }
.md h1, .md h2, .md h3 { margin: 12px 0 6px; line-height: 1.25; }
.md h1 { font-size: 19px; }
.md h2 { font-size: 17px; }
.md h3 { font-size: 15px; }
.md ul, .md ol { margin: 6px 0; padding-left: 1.25rem; }
.md li { margin: 3px 0; }
.md blockquote { margin: 8px 0; padding-left: 10px; border-left: 3px solid var(--border); color: var(--fg2); }
.md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: rgba(255,255,255,0.08); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.md pre { margin: 8px 0; padding: 10px 12px; overflow-x: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.md pre code { display: block; padding: 0; border: 0; background: none; white-space: pre; word-break: normal; }
.md a { color: #78ddff; text-decoration: underline; text-underline-offset: 3px; }
.md-table-wrap { overflow-x: auto; margin: 8px 0; border: 1px solid var(--border); border-radius: 8px; }
.md table { min-width: 100%; border-collapse: collapse; font-size: 12px; }
.md th, .md td { padding: 6px 8px; border: 1px solid var(--border); text-align: left; vertical-align: top; }
.md th { background: rgba(255,255,255,0.05); }
.input-area { padding: 8px 12px; border-top: 1px solid var(--border); background: var(--surface); display: flex; gap: 8px; align-items: center; }
.input-area input[type="text"], .input-area input.text { flex: 1; padding: 10px 14px; border-radius: 20px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 15px; outline: none; }
.input-area input.text:focus { border-color: var(--accent); }
.upload-btn { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border); background: transparent; color: var(--fg2); font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; overflow: hidden; }
.upload-btn:hover { border-color: var(--accent); color: var(--accent); }
.upload-btn input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; font-size: 100px; }
.input-area button.send { width: 40px; height: 40px; border-radius: 50%; border: none; background: var(--accent); color: #fff; font-size: 18px; cursor: pointer; flex-shrink: 0; }
.input-area button.send:disabled { opacity: 0.3; }
.upload-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: var(--accent); color: #fff; border-radius: 12px; font-size: 12px; margin: 2px; }
.upload-chip-x { cursor: pointer; opacity: 0.7; }
.tasks-list { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.task-item { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.task-item-header { display: flex; justify-content: space-between; align-items: center; }
.task-prompt { font-size: 13px; color: var(--fg); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-schedule { font-size: 11px; color: var(--fg2); margin-top: 4px; }
.task-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--fg2); font-size: 11px; cursor: pointer; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--fg2); font-size: 14px; }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>Kira Remote</h1>
    <div class="header-right">
      <button class="new-chat-btn" onclick="newChat()">+ New</button>
      <div class="status"><span class="status-dot" id="dot"></span><span id="statusText">Connecting...</span></div>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('chat')">Chat</button>
    <button class="tab" onclick="switchTab('tasks')">Tasks</button>
  </div>
  <div class="view active" id="chatView">
    <div class="messages" id="msgs"></div>
    <div id="uploadChips" style="padding: 0 12px;"></div>
    <div class="input-area">
      <label class="upload-btn" title="Upload">
        +
        <input type="file" id="fileInput" multiple onchange="uploadFiles(this.files)" />
      </label>
      <input type="text" class="text" id="inp" placeholder="发消息..." autocomplete="off" />
      <button id="sendBtn" class="send" onclick="send()">↑</button>
    </div>
  </div>
  <div class="view" id="tasksView">
    <div class="tasks-list" id="tasksList"><div class="empty">Loading...</div></div>
  </div>
</div>
<script>
const TOKEN = "${token}";
const BASE = location.origin;
let ws, sessionId, streaming = "";
let uploadedFiles = [];

async function uploadFiles(files) {
  for (const file of files) {
    try {
      const r = await fetch(BASE + "/api/upload?token=" + TOKEN + "&name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const d = await r.json();
      if (d.ok) {
        uploadedFiles.push(d);
        renderChips();
      }
    } catch (e) { console.error(e); }
  }
  document.getElementById("fileInput").value = "";
}

function renderChips() {
  const el = document.getElementById("uploadChips");
  el.innerHTML = uploadedFiles.map((f, i) =>
    '<span class="upload-chip">' + esc(f.name) + ' <span class="upload-chip-x" onclick="removeChip(' + i + ')">✗</span></span>'
  ).join("");
}

function removeChip(i) {
  uploadedFiles.splice(i, 1);
  renderChips();
}

function connect() {
  const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws?token=" + TOKEN;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { document.getElementById("dot").className = "status-dot"; document.getElementById("statusText").textContent = "Connected"; };
  ws.onclose = () => { document.getElementById("dot").className = "status-dot off"; document.getElementById("statusText").textContent = "Disconnected"; setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "text_delta") {
      streaming += ev.text || "";
      updateLastAI(streaming);
    } else if (ev.type === "done" || ev.type === "cancelled") {
      streaming = "";
      document.getElementById("sendBtn").disabled = false;
    } else if (ev.type === "error") {
      addMsg("msg-error", ev.error);
      streaming = "";
      document.getElementById("sendBtn").disabled = false;
    }
  };
}

async function send() {
  const inp = document.getElementById("inp");
  let text = inp.value.trim();
  if (!text && uploadedFiles.length === 0) return;
  // Prepend uploaded file paths so AI knows what to read
  if (uploadedFiles.length > 0) {
    const fileList = uploadedFiles.map(f => "- " + f.path).join("\\n");
    text = "我上传了以下文件：\\n" + fileList + "\\n\\n" + text;
    uploadedFiles = [];
    renderChips();
  }
  inp.value = "";
  if (!sessionId) {
    const r = await fetch(BASE + "/api/sessions?token=" + TOKEN, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({title: text.slice(0,40)}) });
    const d = await r.json(); sessionId = d.id;
  }
  addMsg("msg-user", text);
  document.getElementById("sendBtn").disabled = true;
  streaming = "";
  addMsg("msg-ai", "...");
  fetch(BASE + "/api/chat?token=" + TOKEN, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ sessionId, text }) });
}

function addMsg(cls, text) {
  const msgs = document.getElementById("msgs");
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.innerHTML = renderMarkdown(text);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function updateLastAI(text) {
  const msgs = document.getElementById("msgs");
  const last = msgs.lastElementChild;
  if (last && last.classList.contains("msg-ai")) { last.innerHTML = renderMarkdown(text); msgs.scrollTop = msgs.scrollHeight; }
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t, i) => { t.classList.toggle("active", (i === 0 && tab === "chat") || (i === 1 && tab === "tasks")); });
  document.getElementById("chatView").classList.toggle("active", tab === "chat");
  document.getElementById("tasksView").classList.toggle("active", tab === "tasks");
  if (tab === "tasks") loadTasks();
}

async function loadTasks() {
  const r = await fetch(BASE + "/api/tasks?token=" + TOKEN);
  const tasks = await r.json();
  const el = document.getElementById("tasksList");
  if (!tasks.length) { el.innerHTML = '<div class="empty">No tasks</div>'; return; }
  el.innerHTML = tasks.map(t => '<div class="task-item"><div class="task-item-header"><span class="task-prompt">' + esc(t.prompt.slice(0,50)) + '</span><button class="task-btn" onclick="toggleTask(\\'' + t.id + '\\',' + t.enabled + ')">' + (t.enabled ? "Pause" : "Resume") + '</button></div><div class="task-schedule">' + t.cron + ' | ' + (t.enabled ? "Active" : "Paused") + '</div></div>').join("");
}

async function toggleTask(id, enabled) {
  await fetch(BASE + "/api/tasks/" + id + "/" + (enabled ? "pause" : "resume") + "?token=" + TOKEN, { method: "POST" });
  loadTasks();
}

function newChat() {
  sessionId = null;
  document.getElementById("msgs").innerHTML = "";
  streaming = "";
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

function renderMarkdown(source) {
  const blocks = [];
  let html = esc(source || "").replace(new RegExp("\\\\r\\\\n?", "g"), "\\n");
  const fencePattern = new RegExp("\\\\x60\\\\x60\\\\x60([a-zA-Z0-9_-]+)?\\\\n([\\\\s\\\\S]*?)\\\\x60\\\\x60\\\\x60", "g");
  html = html.replace(fencePattern, (_, lang, code) => {
    const token = "__CODE_BLOCK_" + blocks.length + "__";
    blocks.push('<pre><code' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '>' + code + '</code></pre>');
    return token;
  });
  html = renderTables(html);
  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^[-*] \\[x\\] (.+)$/gim, '<ul><li><input type="checkbox" checked disabled> $1</li></ul>')
    .replace(/^[-*] \\[ \\] (.+)$/gim, '<ul><li><input type="checkbox" disabled> $1</li></ul>')
    .replace(/^[-*] (.+)$/gm, "<ul><li>$1</li></ul>")
    .replace(/^\\d+\\. (.+)$/gm, "<ol><li>$1</li></ol>")
    .replace(new RegExp("\\\\x60([^\\\\x60]+)\\\\x60", "g"), "<code>$1</code>")
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+|mailto:[^\\s)]+)\\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html
    .replace(/<\\/ul>\\n<ul>/g, "\\n")
    .replace(/<\\/ol>\\n<ol>/g, "\\n")
    .split(/\\n{2,}/)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      if (/^__CODE_BLOCK_\\d+__$/.test(trimmed)) return trimmed;
      if (/^<(h\\d|ul|ol|blockquote|pre|div|table)/.test(trimmed)) return trimmed;
      return "<p>" + trimmed.replace(/\\n/g, "<br>") + "</p>";
    })
    .join("");
  html = html.replace(/__CODE_BLOCK_(\\d+)__/g, (_, index) => blocks[Number(index)] || "");
  return '<div class="md">' + html + '</div>';
}

function renderTables(input) {
  const tablePattern = new RegExp("(?:^|\\\\n)((?:\\\\|.*\\\\|\\\\n)+\\\\|?\\\\s*:?-{3,}:?\\\\s*(?:\\\\|\\\\s*:?-{3,}:?\\\\s*)+\\\\|?\\\\n(?:\\\\|.*\\\\|(?:\\\\n|$))+)","g");
  return input.replace(tablePattern, (match, tableText) => {
    const rows = tableText.trim().split("\\n").map((line) => line.trim().replace(/^\\||\\|$/g, "").split("|").map((cell) => cell.trim()));
    if (rows.length < 3) return match;
    const head = rows[0];
    const body = rows.slice(2);
    const thead = "<thead><tr>" + head.map((cell) => "<th>" + cell + "</th>").join("") + "</tr></thead>";
    const tbody = "<tbody>" + body.map((row) => "<tr>" + row.map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("") + "</tbody>";
    return '\\n<div class="md-table-wrap"><table>' + thead + tbody + '</table></div>\\n';
  });
}

document.getElementById("inp").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
connect();
</script>
</body>
</html>`;
}
