import { Notice, Platform, type Setting, type SettingGroup } from "obsidian";
import type { ConflictActionType, SyncDirectionType } from "../../baseTypes";
import type RemotelySavePlugin from "../../main";
import { changeMobileStatusBar } from "../../misc";
import { stringToFragment } from "../../misc";
import type { TFunction } from "../helpers";
import { SyncConfigDirModal } from "../modals";

export function buildAdvancedSection(
  advGroup: SettingGroup,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  // ── Performance ──
  advGroup.addSetting((setting) => {
    setting.setHeading().setName("🚀 " + t("settings_performance"));
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_concurrency"))
      .setDesc(t("settings_concurrency_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("1", "1");
        dropdown.addOption("2", "2");
        dropdown.addOption("3", "3");
        dropdown.addOption("5", "5 (default)");
        dropdown.addOption("10", "10");
        dropdown.addOption("15", "15");
        dropdown.addOption("20", "20");

        dropdown
          .setValue(`${plugin.settings.concurrency}`)
          .onChange(async (val) => {
            const realVal = Number.parseInt(val);
            plugin.settings.concurrency = realVal;
            await plugin.saveSettings();
          });
      });
  });

  // ── Sync Behavior ──
  advGroup.addSetting((setting) => {
    setting.setHeading().setName("🔄 " + t("settings_sync_behavior"));
  });

  let conflictActionSetting: Setting;
  advGroup.addSetting((setting) => {
    conflictActionSetting = setting;
    setting
      .setName(t("settings_conflictaction"))
      .setDesc(stringToFragment(t("settings_conflictaction_desc")))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("keep_newer", t("settings_conflictaction_keep_newer"))
          .addOption("keep_larger", t("settings_conflictaction_keep_larger"))
          .setValue(plugin.settings.conflictAction ?? "keep_newer")
          .onChange(async (val) => {
            plugin.settings.conflictAction = val as ConflictActionType;
            await plugin.saveSettings();
            conflictActionSetting.setDesc(
              stringToFragment(t("settings_conflictaction_desc"))
            );
          });
      });
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("setting_syncdirection"))
      .setDesc(stringToFragment(t("setting_syncdirection_desc")))
      .addDropdown((dropdown) => {
        dropdown.addOption(
          "bidirectional",
          t("setting_syncdirection_bidirectional_desc")
        );
        dropdown.addOption(
          "incremental_push_only",
          t("setting_syncdirection_incremental_push_only_desc")
        );
        dropdown.addOption(
          "incremental_pull_only",
          t("setting_syncdirection_incremental_pull_only_desc")
        );
        dropdown.addOption(
          "incremental_push_and_delete_only",
          t("setting_syncdirection_incremental_push_and_delete_only_desc")
        );
        dropdown.addOption(
          "incremental_pull_and_delete_only",
          t("setting_syncdirection_incremental_pull_and_delete_only_desc")
        );

        dropdown
          .setValue(plugin.settings.syncDirection ?? "bidirectional")
          .onChange(async (val) => {
            plugin.settings.syncDirection = val as SyncDirectionType;
            await plugin.saveSettings();
          });
      });
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_protectmodifypercentage"))
      .setDesc(t("settings_protectmodifypercentage_desc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "100";
        text
          .setPlaceholder("50")
          .setValue(`${plugin.settings.protectModifyPercentage ?? 50}`)
          .onChange(async (val) => {
            let k = Number.parseFloat(val.trim());
            if (!Number.isNaN(k)) {
              if (k < 0) k = 0;
              else if (k > 100) k = 100;
              plugin.settings.protectModifyPercentage = k;
              await plugin.saveSettings();
            }
          });
      });
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_deletetowhere"))
      .setDesc(t("settings_deletetowhere_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("system", t("settings_deletetowhere_system_trash"));
        dropdown.addOption(
          "obsidian",
          t("settings_deletetowhere_obsidian_trash")
        );
        dropdown
          .setValue(plugin.settings.deleteToWhere ?? "system")
          .onChange(async (val) => {
            plugin.settings.deleteToWhere = val as "system" | "obsidian";
            await plugin.saveSettings();
          });
      });
  });

  // ── Miscellaneous ──
  advGroup.addSetting((setting) => {
    setting.setHeading().setName("📎 " + t("settings_misc"));
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_syncunderscore"))
      .setDesc(t("settings_syncunderscore_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("disable", t("disable"));
        dropdown.addOption("enable", t("enable"));
        dropdown
          .setValue(
            `${plugin.settings.syncUnderscoreItems ? "enable" : "disable"}`
          )
          .onChange(async (val) => {
            plugin.settings.syncUnderscoreItems = val === "enable";
            await plugin.saveSettings();
          });
      });
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_configdir"))
      .setDesc(
        t("settings_configdir_desc", {
          configDir: plugin.app.vault.configDir,
        })
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("disable", t("disable"));
        dropdown.addOption("enable", t("enable"));

        const bridge = {
          secondConfirm: false,
        };
        dropdown
          .setValue(`${plugin.settings.syncConfigDir ? "enable" : "disable"}`)
          .onChange(async (val) => {
            if (val === "enable" && !bridge.secondConfirm) {
              dropdown.setValue("disable");
              new SyncConfigDirModal(plugin.app, plugin, () => {
                bridge.secondConfirm = true;
                dropdown.setValue("enable");
              }).open();
            } else {
              bridge.secondConfirm = false;
              plugin.settings.syncConfigDir = false;
              await plugin.saveSettings();
            }
          });
      });
  });

  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_bookmarks"))
      .setDesc(
        t("settings_bookmarks_desc", {
          configDir: plugin.app.vault.configDir,
        })
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("disable", t("disable"));
        dropdown.addOption("enable", t("enable"));

        dropdown
          .setValue(`${plugin.settings.syncBookmarks ? "enable" : "disable"}`)
          .onChange(async (val) => {
            plugin.settings.syncBookmarks = val === "enable";
            await plugin.saveSettings();
          });
      });
  });

  if (!Platform.isMobileApp) {
    advGroup.addSetting((setting) => {
      setting
        .setName(t("settings_enablestatusbar_info"))
        .setDesc(t("settings_enablestatusbar_info_desc"))
        .addToggle((toggle) => {
          toggle
            .setValue(plugin.settings.enableStatusBarInfo ?? false)
            .onChange(async (val) => {
              plugin.settings.enableStatusBarInfo = val;
              await plugin.saveSettings();
              new Notice(t("settings_enablestatusbar_reloadrequired_notice"));
            });
        });
    });
  }

  if (Platform.isMobile) {
    advGroup.addSetting((setting) => {
      setting
        .setName(t("settings_enablemobilestatusbar"))
        .setDesc(t("settings_enablemobilestatusbar_desc"))
        .addDropdown(async (dropdown) => {
          dropdown
            .addOption("enable", t("enable"))
            .addOption("disable", t("disable"));

          dropdown
            .setValue(
              `${plugin.settings.enableMobileStatusBar ? "enable" : "disable"}`
            )
            .onChange(async (val) => {
              if (val === "enable") {
                plugin.settings.enableMobileStatusBar = true;
                plugin.appContainerObserver = changeMobileStatusBar("enable");
              } else {
                plugin.settings.enableMobileStatusBar = false;
                changeMobileStatusBar("disable", plugin.appContainerObserver);
                plugin.appContainerObserver?.disconnect();
                plugin.appContainerObserver = undefined;
              }
              await plugin.saveSettings();
            });
        });
    });
  }

  // ── Empty folder handling ──
  advGroup.addSetting((setting) => {
    setting
      .setName(t("settings_cleanemptyfolder"))
      .setDesc(t("settings_cleanemptyfolder_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(
          "clean_both",
          t("settings_cleanemptyfolder_clean_both")
        );
        dropdown.addOption("skip", t("settings_cleanemptyfolder_skip"));
        dropdown
          .setValue(plugin.settings.howToCleanEmptyFolder ?? "clean_both")
          .onChange(async (val) => {
            plugin.settings.howToCleanEmptyFolder = val as
              | "skip"
              | "clean_both";
            await plugin.saveSettings();
          });
      });
  });
}
