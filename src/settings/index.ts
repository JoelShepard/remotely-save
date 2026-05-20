import { Cloud, HardDrive, createElement } from "lucide";
import { type App, PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../baseTypes";
import type { TransItemType } from "../i18n";
import type RemotelySavePlugin from "../main";
import type { TFunction } from "./helpers";
import { injectStyles, renderServiceCard } from "./helpers";
import { buildAdvancedSection } from "./sections/advanced";
import { buildDebugSection } from "./sections/debug";
import { buildEncryptionSection } from "./sections/encryption";
import { buildImportExportSection } from "./sections/importExport";
import { buildLogsSection } from "./sections/logs";
import { buildS3Section } from "./sections/s3";
import { buildWebdavSection } from "./sections/webdav";

export { ChangeRemoteBaseDirModal } from "./modals";
export { wrapTextWithPasswordHide } from "./helpers";

export class RemotelySaveSettingTab extends PluginSettingTab {
  readonly plugin: RemotelySavePlugin;

  constructor(app: App, plugin: RemotelySavePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.style.setProperty("overflow-wrap", "break-word");
    containerEl.empty();

    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    injectStyles(containerEl);

    // ── Service Selector (visual cards) ──
    const serviceSetting = new Setting(containerEl)
      .setName(t("settings_chooseservice"))
      .setDesc(t("settings_chooseservice_desc"));

    // Add card selector below the setting description
    const selectorContainer = serviceSetting.descEl.createDiv({
      cls: "rs-service-selector",
    });
    const cloudSvg = createElement(Cloud).outerHTML;
    const hdSvg = createElement(HardDrive).outerHTML;
    renderServiceCard(
      selectorContainer,
      "s3",
      cloudSvg,
      t("settings_chooseservice_s3"),
      this.plugin.settings.serviceType === "s3",
      () => {
        this.plugin.settings.serviceType = "s3" as SUPPORTED_SERVICES_TYPE;
        this.plugin.saveSettings();
        this.display();
      }
    );
    renderServiceCard(
      selectorContainer,
      "webdav",
      hdSvg,
      t("settings_chooseservice_webdav"),
      this.plugin.settings.serviceType === "webdav",
      () => {
        this.plugin.settings.serviceType = "webdav" as SUPPORTED_SERVICES_TYPE;
        this.plugin.saveSettings();
        this.display();
      }
    );

    // ── Remote Service Config ──
    if (this.plugin.settings.serviceType === "s3") {
      const s3Group = new SettingGroup(containerEl).setHeading(
        "☁️ " + t("settings_s3")
      );
      buildS3Section(s3Group, this.plugin, this.app, t);
    } else if (this.plugin.settings.serviceType === "webdav") {
      const webdavGroup = new SettingGroup(containerEl).setHeading(
        "🗄️ " + t("settings_webdav")
      );
      buildWebdavSection(webdavGroup, this.plugin, this.app, t);
    }

    // ── Encryption ──
    buildEncryptionSection(
      new SettingGroup(containerEl).setHeading(
        "🔒 " + t("settings_encryption")
      ),
      this.plugin,
      t
    );

    // ── Sync Triggers ──
    const triggersGroup = new SettingGroup(containerEl).setHeading(
      "⚡ " + t("settings_sync_triggers")
    );
    this.buildSyncTriggersSection(triggersGroup, t);

    // ── Path Filters ──
    const pathGroup = new SettingGroup(containerEl).setHeading(
      "📂 " + t("settings_path_filters")
    );
    this.buildPathFiltersSection(pathGroup, t);

    // ── Advanced Settings ──
    buildAdvancedSection(
      new SettingGroup(containerEl).setHeading("⚙️ " + t("settings_adv")),
      this.plugin,
      t
    );

    // ── Import / Export ──
    const ieGroup = new SettingGroup(containerEl).setHeading(
      "📦 " + t("settings_importexport")
    );
    buildImportExportSection(ieGroup, this.plugin, t);

    // ── Debug ──
    const debugGroup = new SettingGroup(containerEl).setHeading(
      "🐛 " + t("settings_debug")
    );

    // Dev mode toggle inside debug section
    debugGroup.addSetting((setting: Setting) => {
      setting
        .setName(t("settings_showdevoptions"))
        .setDesc(t("settings_showdevoptions_desc"))
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.showDeveloperOptions ?? false)
            .onChange(async (val: boolean) => {
              this.plugin.settings.showDeveloperOptions = val;
              await this.plugin.saveSettings();
              this.display();
            });
        });
    });

    buildDebugSection(debugGroup, this.plugin, t);

    // Logs: only shown when dev mode is on
    if (this.plugin.settings.showDeveloperOptions) {
      buildLogsSection(
        new SettingGroup(containerEl).setHeading("📋 Logs"),
        this.plugin,
        t
      );
    }
  }

  private buildSyncTriggersSection(group: SettingGroup, t: TFunction): void {
    group.addSetting((setting: Setting) => {
      setting
        .setName(t("settings_autorun"))
        .setDesc(t("settings_autorun_desc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("-1", t("settings_autorun_notset"));
          dropdown.addOption(`${1000 * 60 * 1}`, t("settings_autorun_1min"));
          dropdown.addOption(`${1000 * 60 * 5}`, t("settings_autorun_5min"));
          dropdown.addOption(`${1000 * 60 * 10}`, t("settings_autorun_10min"));
          dropdown.addOption(`${1000 * 60 * 30}`, t("settings_autorun_30min"));
          dropdown
            .setValue(`${this.plugin.settings.autoRunEveryMilliseconds}`)
            .onChange(async (val: string) => {
              const realVal = Number.parseInt(val);
              this.plugin.settings.autoRunEveryMilliseconds = realVal;
              await this.plugin.saveSettings();
              if (
                (realVal === undefined || realVal === null || realVal <= 0) &&
                this.plugin.autoRunIntervalID !== undefined
              ) {
                window.clearInterval(this.plugin.autoRunIntervalID);
                this.plugin.autoRunIntervalID = undefined;
              } else if (
                realVal !== undefined &&
                realVal !== null &&
                realVal > 0
              ) {
                const intervalID = window.setInterval(() => {
                  console.info("auto run from settings.ts");
                  this.plugin.syncRun("auto");
                }, realVal);
                this.plugin.autoRunIntervalID = intervalID;
                this.plugin.registerInterval(intervalID);
              }
            });
        });
    });

    group.addSetting((setting: Setting) => {
      setting
        .setName(t("settings_runoncestartup"))
        .setDesc(t("settings_runoncestartup_desc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("-1", t("settings_runoncestartup_notset"));
          dropdown.addOption(
            `${1000 * 1 * 1}`,
            t("settings_runoncestartup_1sec")
          );
          dropdown.addOption(
            `${1000 * 10 * 1}`,
            t("settings_runoncestartup_10sec")
          );
          dropdown.addOption(
            `${1000 * 30 * 1}`,
            t("settings_runoncestartup_30sec")
          );
          dropdown
            .setValue(`${this.plugin.settings.initRunAfterMilliseconds}`)
            .onChange(async (val: string) => {
              const realVal = Number.parseInt(val);
              this.plugin.settings.initRunAfterMilliseconds = realVal;
              await this.plugin.saveSettings();
            });
        });
    });
  }

  private buildPathFiltersSection(group: SettingGroup, t: TFunction): void {
    group.addSetting((setting: Setting) => {
      setting
        .setName(t("settings_skiplargefiles"))
        .setDesc(t("settings_skiplargefiles_desc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("-1", t("settings_skiplargefiles_notset"));
          const mbs = [1, 5, 10, 20, 50, 100, 200, 500, 1000];
          for (const mb of mbs) {
            dropdown.addOption(`${mb * 1000 * 1000}`, `${mb} MB`);
          }
          dropdown
            .setValue(`${this.plugin.settings.skipSizeLargerThan}`)
            .onChange(async (val: string) => {
              this.plugin.settings.skipSizeLargerThan = Number.parseInt(val);
              await this.plugin.saveSettings();
            });
        });
    });

    group.addSetting((setting: Setting) => {
      setting
        .setName(t("settings_ignorepaths"))
        .setDesc(t("settings_ignorepaths_desc"))
        .setClass("ignorepaths-settings")
        .addTextArea((textArea) => {
          textArea
            .setValue(`${(this.plugin.settings.ignorePaths ?? []).join("\n")}`)
            .onChange(async (value) => {
              this.plugin.settings.ignorePaths = value
                .trim()
                .split("\n")
                .filter((x) => x.trim() !== "");
              await this.plugin.saveSettings();
            });
          textArea.inputEl.rows = 6;
          textArea.inputEl.cols = 30;
          textArea.inputEl.addClass("ignorepaths-textarea");
        });
    });

    group.addSetting((setting: Setting) => {
      setting
        .setName(t("settings_onlyallowpaths"))
        .setDesc(t("settings_onlyallowpaths_desc"))
        .setClass("onlyallowpaths-settings")
        .addTextArea((textArea) => {
          textArea
            .setValue(
              `${(this.plugin.settings.onlyAllowPaths ?? []).join("\n")}`
            )
            .onChange(async (value) => {
              this.plugin.settings.onlyAllowPaths = value
                .trim()
                .split("\n")
                .filter((x) => x.trim() !== "");
              await this.plugin.saveSettings();
            });
          textArea.inputEl.rows = 6;
          textArea.inputEl.cols = 30;
          textArea.inputEl.addClass("onlyallowpaths-textarea");
        });
    });
  }

  hide() {
    const { containerEl } = this;
    containerEl.empty();
    super.hide();
  }
}
