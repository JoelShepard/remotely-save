import { type App, PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../baseTypes";
import type { TransItemType } from "../i18n";
import type RemotelySavePlugin from "../main";
import { injectStyles } from "./helpers";
import { buildAdvancedSection } from "./sections/advanced";
import { buildBasicSection } from "./sections/basic";
import { buildDebugSection } from "./sections/debug";
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

    new Setting(containerEl)
      .setName(t("settings_chooseservice"))
      .setDesc(t("settings_chooseservice_desc"))
      .addDropdown(async (dropdown) => {
        dropdown.addOption("s3", t("settings_chooseservice_s3"));
        dropdown.addOption("webdav", t("settings_chooseservice_webdav"));

        dropdown
          .setValue(this.plugin.settings.serviceType)
          .onChange(async (val) => {
            this.plugin.settings.serviceType = val as SUPPORTED_SERVICES_TYPE;
            await this.plugin.saveSettings();
            this.display(); // Re-render to show/hide sections
          });
      });

    if (this.plugin.settings.serviceType === "s3") {
      const s3Group = new SettingGroup(containerEl).setHeading(
        t("settings_s3")
      );
      buildS3Section(s3Group, this.plugin, this.app, t);
    } else if (this.plugin.settings.serviceType === "webdav") {
      const webdavGroup = new SettingGroup(containerEl).setHeading(
        t("settings_webdav")
      );
      buildWebdavSection(webdavGroup, this.plugin, this.app, t);
    }

    buildBasicSection(
      new SettingGroup(containerEl).setHeading(t("settings_basic")),
      this.plugin,
      t
    );

    buildAdvancedSection(
      new SettingGroup(containerEl).setHeading(t("settings_adv")),
      this.plugin,
      t
    );

    buildImportExportSection(
      new SettingGroup(containerEl).setHeading(t("settings_importexport")),
      this.plugin,
      t
    );

    buildDebugSection(
      new SettingGroup(containerEl).setHeading(t("settings_debug")),
      this.plugin,
      t
    );

    buildLogsSection(
      new SettingGroup(containerEl).setHeading("Logs"),
      this.plugin,
      t
    );
  }

  hide() {
    const { containerEl } = this;
    containerEl.empty();
    super.hide();
  }
}
