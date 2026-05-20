import { Modal, Platform, Setting } from "obsidian";
import type { LogEntry, LogLevel } from "./logManager";
import {
  clearLogs,
  getLogs,
  startLogInterception,
  stopLogInterception,
} from "./logManager";
import type RemotelySavePlugin from "./main";

export class LogViewerModal extends Modal {
  private plugin: RemotelySavePlugin;
  private logsTextArea!: HTMLTextAreaElement;
  private filterSelect!: HTMLSelectElement;
  private autoRefreshInterval: number | undefined;
  private isLiveMode = false;

  constructor(plugin: RemotelySavePlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.titleEl.setText("Log Viewer — Remote Sync");
    this.modalEl.addClass("rs-log-viewer-modal");

    const { contentEl } = this;
    contentEl.empty();

    // ── Toolbar ──
    const toolbar = contentEl.createDiv({ cls: "rs-log-viewer-toolbar" });

    // Filter by level
    this.filterSelect = toolbar.createEl("select", { cls: "rs-log-filter" });
    const filterOptions = [
      { value: "", label: "All Levels" },
      { value: "error", label: "Error" },
      { value: "warn", label: "Warn" },
      { value: "info", label: "Info" },
      { value: "debug", label: "Debug" },
    ];
    for (const opt of filterOptions) {
      const option = this.filterSelect.createEl("option");
      option.value = opt.value;
      option.textContent = opt.label;
    }
    this.filterSelect.addEventListener("change", () => this.refreshLogs());

    // Refresh button
    const refreshBtn = toolbar.createEl("button", { text: "⟳ Refresh" });
    refreshBtn.addEventListener("click", () => this.refreshLogs());

    // Live mode toggle
    const liveBtn = toolbar.createEl("button", {
      text: "▶ Live",
      cls: "rs-log-live-btn",
    });
    liveBtn.addEventListener("click", () => {
      this.isLiveMode = !this.isLiveMode;
      liveBtn.setText(this.isLiveMode ? "⏸ Pause" : "▶ Live");
      if (this.isLiveMode) {
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    });

    // Copy button
    const copyBtn = toolbar.createEl("button", { text: "📋 Copy" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.logsTextArea.value);
    });

    // Export button
    const exportBtn = toolbar.createEl("button", { text: "💾 Export" });
    exportBtn.addEventListener("click", async () => {
      const now = Date.now();
      const fileName = `_debug_remote_sync/logs_exported_on_${now}.md`;
      await this.plugin.app.vault.create(fileName, this.logsTextArea.value);
    });

    // Clear button
    const clearBtn = toolbar.createEl("button", { text: "🗑 Clear" });
    clearBtn.addEventListener("click", async () => {
      await clearLogs();
      this.refreshLogs();
    });

    // Interception toggle
    const interceptToggle = toolbar.createEl("button", {
      text: "⏹ Stop Capture",
    });
    let isIntercepting = true;
    interceptToggle.addEventListener("click", () => {
      isIntercepting = !isIntercepting;
      if (isIntercepting) {
        startLogInterception();
        interceptToggle.setText("⏹ Stop Capture");
      } else {
        stopLogInterception();
        interceptToggle.setText("▶ Start Capture");
      }
    });

    // ── Log count / status ──
    const statusLine = contentEl.createDiv({ cls: "rs-log-viewer-status" });

    // ── Log text area ──
    this.logsTextArea = contentEl.createEl("textarea", {
      cls: "rs-log-viewer-textarea",
      attr: {
        readonly: "",
        wrap: "off",
        spellcheck: "false",
      },
    });

    // ── Bottom controls ──
    const bottomBar = contentEl.createDiv({ cls: "rs-log-viewer-bottom" });

    const wordWrapCb = bottomBar.createEl("label");
    const wordWrapCheck = wordWrapCb.createEl("input", {
      attr: { type: "checkbox" },
    });
    wordWrapCb.appendText(" Word wrap");
    wordWrapCheck.addEventListener("change", () => {
      this.logsTextArea.style.whiteSpace = wordWrapCheck.checked
        ? "pre-wrap"
        : "pre";
    });

    const autoScrollCb = bottomBar.createEl("label");
    const autoScrollCheck = autoScrollCb.createEl("input", {
      attr: { type: "checkbox", checked: "" },
    });
    autoScrollCb.appendText(" Auto-scroll");

    let autoScrollEnabled = true;
    autoScrollCheck.addEventListener("change", () => {
      autoScrollEnabled = autoScrollCheck.checked;
    });

    // Initial load
    this.refreshLogs();
    this.updateStatusLine(statusLine);

    // Persist on every filter change (re-count)
    this.filterSelect.addEventListener("change", () => {
      this.updateStatusLine(statusLine);
    });
  }

  private refreshLogs(): void {
    const filterLevel = (this.filterSelect.value || undefined) as
      | LogLevel
      | undefined;

    const logs = getLogs(filterLevel);
    this.logsTextArea.value = logs
      .map((e) => {
        const d = new Date(e.timestamp).toISOString();
        const levelTag = this.getLevelTag(e.level);
        return `${d} ${levelTag} ${e.message}`;
      })
      .join("\n");

    // Auto-scroll to bottom
    this.logsTextArea.scrollTop = this.logsTextArea.scrollHeight;
  }

  private getLevelTag(level: LogLevel): string {
    switch (level) {
      case "error":
        return "[ERR]";
      case "warn":
        return "[WRN]";
      case "info":
        return "[INF]";
      case "debug":
        return "[DBG]";
    }
  }

  private updateStatusLine(el: HTMLElement): void {
    const filterLevel = (this.filterSelect.value || undefined) as
      | LogLevel
      | undefined;
    const logs = getLogs(filterLevel);
    const total = getLogs().length;
    el.setText(
      `Showing ${logs.length} entries${filterLevel ? ` (${filterLevel})` : ""} of ${total} total`
    );
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.autoRefreshInterval = window.setInterval(() => {
      this.refreshLogs();
    }, 2000);
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshInterval !== undefined) {
      window.clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = undefined;
    }
  }

  onClose(): void {
    this.stopAutoRefresh();
    this.contentEl.empty();
  }
}
