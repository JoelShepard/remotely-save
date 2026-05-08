import { type App, PluginSettingTab, Setting } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../baseTypes";
import type { TransItemType } from "../i18n";
import type RemotelySavePlugin from "../main";
import { createSection, injectStyles } from "./helpers";
import { buildAdvancedSection } from "./sections/advanced";
import { buildBasicSection } from "./sections/basic";
import { buildDebugSection } from "./sections/debug";
import { buildImportExportSection } from "./sections/importExport";
import { buildLogsSection } from "./sections/logs";
import { buildS3Section } from "./sections/s3";
import { buildWebdavSection } from "./sections/webdav";
import { buildWebdisSection } from "./sections/webdis";

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

    containerEl.createEl("h1", { text: "Remote Sync" });

    new Setting(containerEl)
      .setName(t("settings_chooseservice"))
      .setDesc(t("settings_chooseservice_desc"))
      .addDropdown(async (dropdown) => {
        dropdown.addOption("s3", t("settings_chooseservice_s3"));
        dropdown.addOption("webdav", t("settings_chooseservice_webdav"));
        dropdown.addOption("webdis", t("settings_chooseservice_webdis"));

        dropdown
          .setValue(this.plugin.settings.serviceType)
          .onChange(async (val) => {
            this.plugin.settings.serviceType = val as SUPPORTED_SERVICES_TYPE;
            await this.plugin.saveSettings();
            this.display(); // Re-render to show/hide sections
          });
      });

    const s3Section = createSection(containerEl, t("settings_s3"));
    buildS3Section(s3Section, this.plugin, this.app, t);
    s3Section.style.display =
      this.plugin.settings.serviceType === "s3" ? "" : "none";

    const webdavSection = createSection(containerEl, t("settings_webdav"));
    buildWebdavSection(webdavSection, this.plugin, this.app, t);
    webdavSection.style.display =
      this.plugin.settings.serviceType === "webdav" ? "" : "none";

    const webdisSection = createSection(containerEl, t("settings_webdis"));
    buildWebdisSection(webdisSection, this.plugin, this.app, t);
    webdisSection.style.display =
      this.plugin.settings.serviceType === "webdis" ? "" : "none";

    buildBasicSection(
      createSection(containerEl, t("settings_basic")),
      this.plugin,
      t
    );

    buildAdvancedSection(
      createSection(containerEl, t("settings_adv")),
      this.plugin,
      t
    );

    buildImportExportSection(
      createSection(containerEl, t("settings_importexport")),
      this.plugin,
      t
    );

    buildDebugSection(
      createSection(containerEl, t("settings_debug")),
      this.plugin,
      t
    );

    buildLogsSection(createSection(containerEl, "Logs"), this.plugin, t);
  }

  hide() {
    const { containerEl } = this;
    containerEl.empty();
    super.hide();
  }
}
