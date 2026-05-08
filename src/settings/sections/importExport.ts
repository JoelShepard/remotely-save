import { cloneDeep } from "lodash";
import { Notice, Setting } from "obsidian";
import { parseUriByHand } from "../../importExport";
import { importQrCodeUri } from "../../importExport";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";
import { ExportSettingsQrCodeModal } from "../modals";

export function buildImportExportSection(
  importExportDiv: HTMLElement,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  const importExportDivSetting1 = new Setting(importExportDiv)
    .setName(t("settings_export"))
    .setDesc(t("settings_export_desc"));
  importExportDivSetting1.settingEl.addClass("setting-need-wrapping");
  importExportDivSetting1
    .addButton(async (button) => {
      button.setButtonText(t("settings_export_basic_and_advanced_button"));
      button.onClick(async () => {
        new ExportSettingsQrCodeModal(
          plugin.app,
          plugin,
          "basic_and_advanced"
        ).open();
      });
    })
    .addButton(async (button) => {
      button.setButtonText(t("settings_export_s3_button"));
      button.onClick(async () => {
        new ExportSettingsQrCodeModal(plugin.app, plugin, "s3").open();
      });
    })
    .addButton(async (button) => {
      button.setButtonText(t("settings_export_webdav_button"));
      button.onClick(async () => {
        new ExportSettingsQrCodeModal(plugin.app, plugin, "webdav").open();
      });
    });

  let importSettingVal = "";
  new Setting(importExportDiv)
    .setName(t("settings_import"))
    .setDesc(t("settings_import_desc"))
    .addText((text) =>
      text
        .setPlaceholder("obsidian://remote-sync?func=settings&...")
        .setValue("")
        .onChange((val) => {
          importSettingVal = val;
        })
    )
    .addButton(async (button) => {
      button.setButtonText(t("confirm"));
      button.onClick(async () => {
        if (importSettingVal !== "") {
          try {
            const inputParams = parseUriByHand(importSettingVal);
            const parsed = importQrCodeUri(
              inputParams,
              plugin.app.vault.getName()
            );
            if (parsed.status === "error") {
              new Notice(parsed.message);
            } else {
              const copied = cloneDeep(parsed.result);
              plugin.settings = Object.assign({}, plugin.settings, copied);
              plugin.saveSettings();
              new Notice(
                t("protocol_saveqr", {
                  manifestName: plugin.manifest.name,
                })
              );
            }
          } catch (e) {
            new Notice(`${e}`);
          }

          importSettingVal = "";
        } else {
          new Notice(t("settings_import_error_notice"));
          importSettingVal = "";
        }
      });
    });
}
