import { Cloud, HardDrive, createElement } from "lucide";
import { type App, PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../baseTypes";
import type { TransItemType } from "../i18n";
import type RemotelySavePlugin from "../main";
import type { TFunction } from "./helpers";
import {
  injectStyles,
  makeGroupCollapsible,
  renderServiceCard,
} from "./helpers";
import { buildAdvancedSection } from "./sections/advanced";
import { buildDebugSection } from "./sections/debug";
import { buildEncryptionSection } from "./sections/encryption";
import { buildImportExportSection } from "./sections/importExport";
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
      const s3Wrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
      const s3Group = new SettingGroup(s3Wrapper).setHeading(
        "☁️ " + t("settings_s3")
      );
      buildS3Section(s3Group, this.plugin, this.app, t);
      makeGroupCollapsible(s3Wrapper, this.plugin, "s3");
    } else if (this.plugin.settings.serviceType === "webdav") {
      const wdWrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
      const webdavGroup = new SettingGroup(wdWrapper).setHeading(
        "🗄️ " + t("settings_webdav")
      );
      buildWebdavSection(webdavGroup, this.plugin, this.app, t);
      makeGroupCollapsible(wdWrapper, this.plugin, "webdav");
    }

    // ── Encryption ──
    const encWrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
    const encGroup = new SettingGroup(encWrapper).setHeading(
      "🔒 " + t("settings_encryption")
    );
    buildEncryptionSection(encGroup, this.plugin, t);
    makeGroupCollapsible(encWrapper, this.plugin, "encryption");

    // ── Sync Triggers ──
    const trigWrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
    const triggersGroup = new SettingGroup(trigWrapper).setHeading(
      "⚡ " + t("settings_sync_triggers")
    );
    this.buildSyncTriggersSection(triggersGroup, t);
    makeGroupCollapsible(trigWrapper, this.plugin, "syncTriggers");

    // ── Path Filters ──
    const pathWrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
    const pathGroup = new SettingGroup(pathWrapper).setHeading(
      "📂 " + t("settings_path_filters")
    );
    this.buildPathFiltersSection(pathGroup, t);
    makeGroupCollapsible(pathWrapper, this.plugin, "pathFilters");

    // ── Advanced Settings ──
    const advWrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
    const advGroup = new SettingGroup(advWrapper).setHeading(
      "⚙️ " + t("settings_adv")
    );
    buildAdvancedSection(advGroup, this.plugin, t);
    makeGroupCollapsible(advWrapper, this.plugin, "advanced");

    // ── Import / Export ──
    const ieWrapper = containerEl.createDiv({ cls: "rs-group-wrapper" });
    const ieGroup = new SettingGroup(ieWrapper).setHeading(
      "📦 " + t("settings_importexport")
    );
    buildImportExportSection(ieGroup, this.plugin, t);
    makeGroupCollapsible(ieWrapper, this.plugin, "importExport");

    // ── Troubleshooting (always visible, not collapsible) ──
    buildDebugSection(
      new SettingGroup(containerEl).setHeading("🛠️ " + t("settings_debug")),
      this.plugin,
      t
    );
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
