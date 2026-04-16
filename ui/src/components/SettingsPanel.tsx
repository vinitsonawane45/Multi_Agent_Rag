import { AppSettings, Theme } from "../types";

type SettingsPanelProps = {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onClose: () => void;
};

export function SettingsPanel({ settings, onUpdateSettings, onClose }: SettingsPanelProps) {
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  return (
    <div className="settings-panel-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>
            <span className="settings-icon">⚙️</span>
            Settings
          </h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          {/* Theme Section */}
          <div className="settings-section">
            <h3>Appearance</h3>
            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Theme</span>
                <span className="setting-description">Choose your preferred color scheme</span>
              </div>
              <div className="theme-selector">
                {(["dark", "light", "system"] as Theme[]).map((theme) => (
                  <button
                    key={theme}
                    className={`theme-option ${settings.theme === theme ? "active" : ""}`}
                    onClick={() => updateSetting("theme", theme)}
                  >
                    <span className="theme-preview">
                      {theme === "dark" && "🌙"}
                      {theme === "light" && "☀️"}
                      {theme === "system" && "💻"}
                    </span>
                    <span className="theme-name">{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Behavior Section */}
          <div className="settings-section">
            <h3>Behavior</h3>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Show Agent Activity</span>
                <span className="setting-description">Display real-time agent processing status</span>
              </div>
              <ToggleSwitch
                checked={settings.showAgentPanel}
                onChange={(checked) => updateSetting("showAgentPanel", checked)}
              />
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Auto-scroll</span>
                <span className="setting-description">Automatically scroll to new messages</span>
              </div>
              <ToggleSwitch
                checked={settings.autoScroll}
                onChange={(checked) => updateSetting("autoScroll", checked)}
              />
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Stream Responses</span>
                <span className="setting-description">Show responses as they're generated</span>
              </div>
              <ToggleSwitch
                checked={settings.streamResponses}
                onChange={(checked) => updateSetting("streamResponses", checked)}
              />
            </div>
          </div>

          {/* Data Section */}
          <div className="settings-section">
            <h3>Data</h3>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Clear Conversation History</span>
                <span className="setting-description">Remove all saved conversation sessions</span>
              </div>
              <button className="btn-danger" onClick={() => {
                if (confirm("Are you sure you want to clear all conversation history?")) {
                  localStorage.removeItem("mar-sessions");
                  window.location.reload();
                }
              }}>
                Clear History
              </button>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="setting-label">Reset All Settings</span>
                <span className="setting-description">Restore default application settings</span>
              </div>
              <button className="btn-danger" onClick={() => {
                if (confirm("Reset all settings to defaults?")) {
                  localStorage.removeItem("mar-settings");
                  window.location.reload();
                }
              }}>
                Reset Settings
              </button>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <span className="settings-version">v0.2.0 — Multi-Agent RAG</span>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className={`toggle-switch ${checked ? "on" : "off"}`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className="toggle-handle"></span>
    </button>
  );
}
