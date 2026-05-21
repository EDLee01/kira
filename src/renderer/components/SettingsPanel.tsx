import { useEffect, useState } from "react";

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [config, setConfig] = useState<any>(null);
  const [appInfo, setAppInfo] = useState<any>(null);

  useEffect(() => {
    window.desktopAPI.getConfig().then(setConfig).catch(() => setConfig({ error: "Could not load config" }));
    window.desktopAPI.getAppInfo().then(setAppInfo).catch(() => {});
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      <div className="settings-body">
        <section>
          <h3>API Configuration</h3>
          <div className="setting-row">
            <label>ANTHROPIC_AUTH_TOKEN</label>
            <code>{process.env.ANTHROPIC_AUTH_TOKEN ? "✅ Set" : "❌ Not set"}</code>
          </div>
          <div className="setting-row">
            <label>ANTHROPIC_BASE_URL</label>
            <code>{process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}</code>
          </div>
        </section>

        {config && (
          <section>
            <h3>Config</h3>
            <pre className="config-preview">{JSON.stringify(config, null, 2)}</pre>
          </section>
        )}

        {appInfo && (
          <section>
            <h3>About</h3>
            <div className="setting-row"><label>Version</label><span>{appInfo.version}</span></div>
            <div className="setting-row"><label>Platform</label><span>{appInfo.platform} ({appInfo.arch})</span></div>
            <div className="setting-row"><label>Node</label><span>{appInfo.nodeVersion}</span></div>
          </section>
        )}
      </div>
    </div>
  );
}
