import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const features = [
  ['自动识别模型', '填入 API URL 和 Key 后，Kira 会读取可用模型，并生成 Auto 路线。'],
  ['浏览器操作', '打开网页、阅读页面、填写表单，把网页任务推进到结果。'],
  ['文件处理', '读取、整理、修改本地文件，适合资料处理和重复工作。'],
  ['命令执行', '在本机运行命令，完成构建、检查、脚本执行等任务。'],
  ['任务记录', '保留会话和任务上下文，方便继续之前的工作。'],
  ['自定义服务', '支持第三方 API URL，适配不同模型服务。'],
];

const steps = [
  ['01', '下载 Kira', '从 GitHub Release 获取 Windows 或 macOS 安装包。'],
  ['02', '配置服务', '填入你的 API URL 和 API Key。'],
  ['03', '识别模型', 'Kira 自动读取可用模型，并生成 Auto 路线。'],
  ['04', '开始任务', '让 Kira 使用浏览器、文件和命令完成本地工作。'],
];

const faqs = [
  ['需要自己的 API Key 吗？', '需要。Kira 使用你配置的 API URL 和 API Key 连接模型服务。'],
  ['支持哪些模型？', '取决于你的 API 服务。Kira 会根据 URL 和 Key 自动读取可用模型。'],
  ['Windows 能用吗？', '可以。Release 页面会提供 Windows 安装包。'],
  ['数据会上传到哪里？', '模型请求会发送到你配置的 API 服务；本地文件操作在你的电脑上完成。'],
];

function ProductMock() {
  return (
    <div className="productFrame">
      <div className="windowBar">
        <span />
        <span />
        <span />
      </div>
      <div className="appMock">
        <aside className="sidebar">
          <div className="sideTitle">Kira</div>
          <div className="sideItem active">任务</div>
          <div className="sideItem">模型</div>
          <div className="sideItem">设置</div>
        </aside>
        <section className="panel">
          <div className="panelHeader">
            <div>
              <p>Auto model routing</p>
              <h3>已识别 12 个可用模型</h3>
            </div>
            <span>Ready</span>
          </div>
          <div className="routeGrid">
            <div><b>fast</b><span>claude-haiku-4-5</span></div>
            <div><b>main</b><span>claude-sonnet-4-6</span></div>
            <div><b>deep</b><span>claude-opus-4-7</span></div>
            <div><b>vision</b><span>gpt-4o</span></div>
          </div>
          <div className="promptBox">整理下载目录里的安装包，并检查 Kira 最新 release 是否完成。</div>
        </section>
      </div>
    </div>
  );
}

function App() {
  return (
    <main className="page">
      <nav className="nav container">
        <a className="brand" href="#top">Kira</a>
        <div className="navLinks">
          <a href="#features">功能</a>
          <a href="#download">下载</a>
          <a href="https://github.com/EDLee01/kira" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section id="top" className="hero container">
        <div className="heroCopy">
          <p className="eyebrow">桌面 AI 助手</p>
          <h1>Kira，让 AI 帮你操作电脑</h1>
          <p className="subtitle">
            连接你的 API URL 和 API Key，自动识别可用模型。让 AI 使用浏览器、处理文件、运行命令，完成本地任务。
          </p>
          <div className="actions">
            <a className="button primary" href="https://github.com/EDLee01/kira/releases/latest" target="_blank" rel="noreferrer">下载 Windows 版</a>
            <a className="button secondary" href="https://github.com/EDLee01/kira/releases/latest" target="_blank" rel="noreferrer">下载 macOS 版</a>
          </div>
        </div>
        <ProductMock />
      </section>

      <section id="features" className="section container">
        <div className="sectionHead centered">
          <p className="eyebrow">功能</p>
          <h2>从配置模型到执行任务</h2>
        </div>
        <div className="featureGrid">
          {features.map(([title, text]) => (
            <article className="card" key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="sectionHead centered">
          <p className="eyebrow">开始使用</p>
          <h2>四步开始</h2>
        </div>
        <div className="steps">
          {steps.map(([number, title, text]) => (
            <article className="step" key={title}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="download" className="download container">
        <p className="eyebrow">下载</p>
        <h2>安装 Kira</h2>
        <p>从 GitHub Release 下载最新版本。</p>
        <div className="actions center">
          <a className="button primary" href="https://github.com/EDLee01/kira/releases/latest" target="_blank" rel="noreferrer">下载最新版本</a>
          <a className="button secondary" href="https://github.com/EDLee01/kira" target="_blank" rel="noreferrer">GitHub 仓库</a>
        </div>
      </section>

      <section className="section container faq">
        <div className="sectionHead centered">
          <p className="eyebrow">FAQ</p>
          <h2>常见问题</h2>
        </div>
        <div className="faqList">
          {faqs.map(([question, answer]) => (
            <article className="faqItem" key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
