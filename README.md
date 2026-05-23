# Kira

Kira 是一个本地优先的 AI agent 桌面助手。

它能理解你的工作区，调用浏览器、终端、文件系统和定时任务，也能在授权后观察屏幕、辅助操作电脑。你只需要像交代同事一
样说清楚目标，它会自己推进、验证，并把关键动作交给你确认。

## 它能干啥

- **聊天** — 写文案、总结资料、回答问题
- **操控浏览器** — "看一下知乎热榜前 10" — 它真的打开浏览器去看
- **处理本地文件** — 选个文件夹，它能读写里面的 Excel、CSV、PDF
- **定时任务** — "每天 9 点盯一下竞品" — 它自己创建定时任务，到点自动跑
- **手机远程** — 开远程后扫码，离开电脑也能继续用

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

[Business Source License 1.1](./LICENSE) — 个人和非商业用途免费。商业 SaaS 服务需联系作者获取商业授权。2029-05-22 后自动转为 MIT。

商业授权咨询：edwardlee5423@gmail.com
