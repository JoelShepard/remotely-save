import { Notice, type SettingGroup } from "obsidian";
import type { LogLevel } from "../../logManager";
import { clearLogs, getLogsAsText } from "../../logManager";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";

export function buildLogsSection(
  logsGroup: SettingGroup,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  logsGroup.addSetting((setting) => {
    setting.infoEl.remove();
    setting.controlEl.remove();
    setting.settingEl.style.display = "block";

    const logsTextArea = setting.settingEl.createEl("textarea", {
      cls: "rs-logs-preview",
      attr: { readonly: "", wrap: "off", spellcheck: "false" },
    });
    const logsRefresh = () => {
      logsTextArea.value = getLogsAsText(
        (logsFilterSelect.value || undefined) as LogLevel | undefined
      );
    };

    const logsActions = setting.settingEl.createDiv({ cls: "rs-logs-actions" });

    const logsFilterSelect = logsActions.createEl("select");
    const filterOptions = [
      { value: "", label: "All levels" },
      { value: "error", label: "Error" },
      { value: "warn", label: "Warn" },
      { value: "info", label: "Info" },
      { value: "debug", label: "Debug" },
    ];
    for (const opt of filterOptions) {
      const option = logsFilterSelect.createEl("option");
      option.value = opt.value;
      option.textContent = opt.label;
    }
    logsFilterSelect.addEventListener("change", logsRefresh);

    const refreshBtn = logsActions.createEl("button", {
      text: "Refresh",
    });
    refreshBtn.addEventListener("click", logsRefresh);

    const copyBtn = logsActions.createEl("button", {
      text: "Copy to Clipboard",
    });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(logsTextArea.value);
      new Notice("Logs copied to clipboard!");
    });

    const exportBtn = logsActions.createEl("button", {
      text: "Export to File",
    });
    exportBtn.addEventListener("click", async () => {
      const now = Date.now();
      const fileName = `_debug_remote_sync/logs_exported_on_${now}.txt`;
      await plugin.app.vault.create(fileName, logsTextArea.value);
      new Notice(`Logs exported to ${fileName}`);
    });

    const clearBtn = logsActions.createEl("button", {
      text: "Clear Logs",
    });
    clearBtn.addEventListener("click", () => {
      clearLogs();
      logsRefresh();
      new Notice("Logs cleared!");
    });

    const autoRefreshCb = logsActions.createEl("label");
    const autoRefreshCheck = autoRefreshCb.createEl("input", {
      attr: { type: "checkbox" },
    });
    autoRefreshCb.appendText(" Auto-refresh");
    let autoRefreshInterval: number | undefined;
    autoRefreshCheck.addEventListener("change", () => {
      if (autoRefreshCheck.checked) {
        autoRefreshInterval = window.setInterval(logsRefresh, 2000);
      } else {
        if (autoRefreshInterval !== undefined) {
          window.clearInterval(autoRefreshInterval);
          autoRefreshInterval = undefined;
        }
      }
    });

    logsRefresh();
  });
}
