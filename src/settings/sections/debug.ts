import { Notice, Platform, Setting, type SettingGroup } from "obsidian";
import { messyConfigToNormal } from "../../configPersist";
import { exportVaultSyncPlansToFiles } from "../../debugMode";
import {
  clearAllPrevSyncRecordByVault,
  clearAllSyncPlanRecords,
  destroyDBs,
  upsertLastFailedSyncTimeByVault,
  upsertLastSuccessSyncTimeByVault,
} from "../../localdb";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";

export function buildDebugSection(
  debugGroup: SettingGroup,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_debuglevel"))
      .setDesc(t("settings_debuglevel_desc"))
      .addDropdown(async (dropdown) => {
        dropdown.addOption("info", "info");
        dropdown.addOption("debug", "debug");
        dropdown
          .setValue(plugin.settings.currLogLevel ?? "info")
          .onChange(async (val: string) => {
            plugin.settings.currLogLevel = val;
            await plugin.saveSettings();
            console.info(`the log level is changed to ${val}`);
          });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_outputsettingsconsole"))
      .setDesc(t("settings_outputsettingsconsole_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_outputsettingsconsole_button"));
        button.onClick(async () => {
          const c = messyConfigToNormal(await plugin.loadData());
          console.info(c);
          new Notice(t("settings_outputsettingsconsole_notice"));
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_obfuscatesettingfile"))
      .setDesc(t("settings_obfuscatesettingfile_desc"))
      .addDropdown(async (dropdown) => {
        dropdown
          .addOption("enable", t("enable"))
          .addOption("disable", t("disable"));

        dropdown
          .setValue(
            `${plugin.settings.obfuscateSettingFile ? "enable" : "disable"}`
          )
          .onChange(async (val) => {
            if (val === "enable") {
              plugin.settings.obfuscateSettingFile = true;
            } else {
              plugin.settings.obfuscateSettingFile = false;
            }
            await plugin.saveSettings();
          });
      });
  });



  debugGroup.addSetting((setting) => {
    setting.setHeading().setName(t("settings_syncplans"));
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_syncplans_button_1_only_change"))
      .setDesc(t("settings_syncplans_desc"))
      .addButton(async (button) => {
        button.setButtonText("Export");
        button.onClick(async () => {
          await exportVaultSyncPlansToFiles(
            plugin.db,
            plugin.app.vault,
            plugin.vaultRandomID,
            1,
            true
          );
          new Notice(t("settings_syncplans_notice"));
        });
      });
  });



  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_syncplans_button_all"))
      .setDesc(t("settings_syncplans_desc"))
      .addButton(async (button) => {
        button.setButtonText("Export");
        button.onClick(async () => {
          await exportVaultSyncPlansToFiles(
            plugin.db,
            plugin.app.vault,
            plugin.vaultRandomID,
            -1,
            false
          );
          new Notice(t("settings_syncplans_notice"));
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_delsyncplans"))
      .setDesc(t("settings_delsyncplans_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_delsyncplans_button"));
        button.onClick(async () => {
          await clearAllSyncPlanRecords(plugin.db);
          new Notice(t("settings_delsyncplans_notice"));
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_delprevsync"))
      .setDesc(t("settings_delprevsync_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_delprevsync_button"));
        button.onClick(async () => {
          await clearAllPrevSyncRecordByVault(plugin.db, plugin.vaultRandomID);
          new Notice(t("settings_delprevsync_notice"));
        });
      });
  });

  if (!Platform.isMobileApp) {
    debugGroup.addSetting((setting) => {
      setting
        .setName(t("settings_resetstatusbar_time"))
        .setDesc(t("settings_resetstatusbar_time_desc"))
        .addButton((button) => {
          button.setButtonText(t("settings_resetstatusbar_button"));
          button.onClick(async () => {
            await upsertLastSuccessSyncTimeByVault(
              plugin.db,
              plugin.vaultRandomID,
              -1
            );
            await upsertLastFailedSyncTimeByVault(
              plugin.db,
              plugin.vaultRandomID,
              -1
            );
            plugin.updateLastSyncMsg(undefined, "not_syncing", null, null);
            new Notice(t("settings_resetstatusbar_notice"));
          });
        });
    });
  }

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_outputbasepathvaultid"))
      .setDesc(t("settings_outputbasepathvaultid_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_outputbasepathvaultid_button"));
        button.onClick(async () => {
          new Notice(plugin.getVaultBasePath());
          new Notice(plugin.vaultRandomID);
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_resetcache"))
      .setDesc(t("settings_resetcache_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_resetcache_button"));
        button.onClick(async () => {
          await destroyDBs();
          new Notice(t("settings_resetcache_notice"));
          plugin.unload();
        });
      });
  });
}
