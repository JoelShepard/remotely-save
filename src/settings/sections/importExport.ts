import { cloneDeep } from "lodash";
import { Notice, Setting, type SettingGroup } from "obsidian";
import { parseUriByHand } from "../../importExport";
import { importQrCodeUri } from "../../importExport";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";
import { ExportSettingsQrCodeModal } from "../modals";

export function buildImportExportSection(
  importExportGroup: SettingGroup,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  let exportType: "basic_and_advanced" | "s3" | "webdav" = "basic_and_advanced";
  importExportGroup.addSetting((setting) => {
    setting
      .setName(t("settings_export"))
      .setDesc(t("settings_export_desc"))
      .setClass("setting-need-wrapping")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("basic_and_advanced", t("settings_export_basic_and_advanced_button"))
          .addOption("s3", t("settings_export_s3_button"))
          .addOption("webdav", t("settings_export_webdav_button"))
          .setValue("basic_and_advanced")
          .onChange((val) => {
            exportType = val as typeof exportType;
          });
      })
      .addButton((button) => {
        button.setButtonText("Export");
        button.onClick(() => {
          new ExportSettingsQrCodeModal(plugin.app, plugin, exportType).open();
        });
      });
  });

  let importSettingVal = "";
  importExportGroup.addSetting((setting) => {
    setting
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
  });
}
