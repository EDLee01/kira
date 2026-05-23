# Kira

Kira 是一个部署在本地的 AI Agent 桌面助手。

基于你设定的工作区，Kira既可以调用浏览器、终端、文件系统和定时任务，也能在授权后观察屏幕、辅助操作电脑。你只需要像交代同事一样说清楚目标，它会自己推进、验证，并把关键动作交给你确认。

## 它能干什么

- 聊天：写文案、总结资料、回答问题
- 操控浏览器：比如“看一下知乎热榜前 10”，它会打开浏览器去看
- 处理本地文件：选择一个文件夹后，它可以读写里面的 Excel、CSV、PDF 和代码文件
- 操作电脑：授权后可以截图、识别屏幕、点击、输入和执行快捷键
- 运行终端：帮你启动项目、跑测试、看报错、修问题
- 定时任务：比如“每天 9 点盯一下竞品”，它可以创建任务，到点自动执行
- 手机远程：开启远程后扫码，离开电脑也能继续使用和审批操作
- 目标跟进：使用 `/goal` 记录长期目标，让任务可以跨多轮持续推进

## 怎么使用

### 1. 安装

#### macOS

下载最新 Release 里的 `Kira-x.x.x-mac.dmg`，双击安装。

#### Windows

下载最新 Release 里的 `Kira-Setup-x.x.x.exe`，双击安装。

首次运行需要在设置里填入 API Key。

### 2. 配置模型

打开 Kira 后，点击右上角齿轮图标进入设置。

需要配置：

- API Base URL
- API Key
- Model

默认可以使用 Anthropic API，也可以填写兼容 Anthropic API 格式的服务地址。

填完后点击 `Test Connection` 验证连通性。

### 3. 选择工作区

选择一个本地文件夹作为工作区。

Kira 会基于这个目录读取上下文、分析文件、执行命令和修改内容。

### 4. 直接交代任务

你可以这样说：

```text
帮我启动这个前端项目，我要测试上传图片。
```

也可以说：

```text
每天早上 9 点帮我看一下竞品有没有更新，有的话总结给我。
```

或者：

```text
看一下当前屏幕，帮我点开浏览器里的设置页面。
```

涉及文件修改、命令执行、电脑控制等关键动作时，Kira 会请求确认。

## 移动端远程

Kira 支持开启远程访问。

开启后可以用手机扫码进入当前会话，继续发送指令、查看执行状态、审批操作或中断任务。

这适合：

- 出门后继续跟进电脑上的任务
- 手机上审批 AI 的关键操作
- 远程查看定时任务执行结果
- 临时补充指令

## `/goal`

`/goal` 用来记录当前长期目标。

例如：

```text
/goal 把 Kira 的 Computer Use 做到稳定可测试
```

设置后，Kira 会在后续对话中持续参考这个目标，减少上下文丢失。

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
npm run dist:mac
npm run dist:win
```

## 技术栈

- Electron 35
- React 19
- Vite 6
- Playwright
- better-sqlite3
- Cloudflare Tunnel

## 安全声明

Kira 使用 AI 辅助完成任务。AI 可能会理解错误、生成不准确内容或执行不符合预期的操作。

在允许文件修改、命令执行、桌面控制或定时任务前，请确认操作内容，并核查重要结果。不要让 AI 处理你不愿承担风险的敏感数据、凭证或生产环境操作。


## 赞助商招募中

Kira 仍在快速迭代。如果你希望支持本项目持续开发，欢迎成为赞助商。

适合赞助的方向包括：

- AI API / 模型服务
- 开发者工具
- 云服务与算力平台
- 自动化、RPA、Computer Use 相关产品
- 远程协作与移动办公工具
- 面向 AI Native 团队的基础设施

赞助商可以获得 README 展示位、版本发布鸣谢和相关场景介绍。

商业合作与赞助咨询：`edwardlee5423@gmail.com`

## License

Business Source License 1.1。

个人和非商业用途免费。商业 SaaS 服务需联系作者获取商业授权。

本项目将在 2029-05-22 后自动转为 MIT License。

商业授权咨询：`edwardlee5423@gmail.com`

