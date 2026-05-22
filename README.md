# Kira

让 AI 帮你操控电脑，完成日常工作。

Kira 是一个桌面 AI 助手，目标用户是不懂技术、但需要 AI 帮忙处理各种工作的普通人。

## 它能做什么

- **对话** — 跟 AI 聊天，让它帮你写文案、总结资料、回答问题
- **操控浏览器** — "帮我打开知乎热榜，看看前 10 个话题" — AI 真的会打开浏览器、截图、提取内容
- **处理本地文件** — 选个工作区文件夹，AI 可以读写里面的文件，处理 Excel、CSV、PDF
- **定时任务** — "每天早上 9 点看一下知乎热榜并整理给我" — AI 自动创建定时任务，到点自动执行
- **手机远程操控** — 开启远程访问，扫码用手机控制桌面端的 AI，离开电脑也能用

## 安装

### macOS

下载最新 Release 里的 `Kira-x.x.x-mac.dmg`，双击安装。

### Windows

下载最新 Release 里的 `Kira-Setup-x.x.x.exe`，双击安装。

> 首次运行需要在设置里填入 API Key。详见下方"配置"。

## 配置

打开 Kira 后，点右上角的齿轮图标进入设置：

- **API Base URL** — 默认 `https://api.anthropic.com`，国内可换成 hotaitool 等代理
- **API Key** — 你的 Claude/Anthropic API Key
- **Model** — 选 Claude Haiku（快）或 Sonnet（强）等

填完点 **Test Connection** 验证连通性。

## 开发

```bash
git clone https://github.com/EDLee01/kira.git
cd kira
npm install
npm run dev:main
npx vite --port 5173 &
NODE_ENV=development npx electron .
```

打包：

```bash
npm run dist:mac    # macOS DMG
npm run dist:win    # Windows NSIS installer
```

## 技术栈

- Electron 35 + React 19 + Vite 6
- Playwright（浏览器自动化）
- better-sqlite3（会话存储）
- Cloudflare Tunnel（手机远程访问）

## License

MIT
