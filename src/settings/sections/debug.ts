import { Notice, Setting, type SettingGroup } from "obsidian";
import { messyConfigToNormal } from "../../configPersist";
import {
  exportVaultProfilerResultsToFiles,
  exportVaultSyncPlansToFiles,
} from "../../debugMode";
import {
  clearAllPrevSyncRecordByVault,
  clearAllSyncPlanRecords,
  destroyDBs,
} from "../../localdb";
import type RemotelySavePlugin from "../../main";
import { stringToFragment } from "../../misc";
import { DEFAULT_PROFILER_CONFIG } from "../../profiler";
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
    setting
      .setName(t("settings_viewconsolelog"))
      .setDesc(stringToFragment(t("settings_viewconsolelog_desc")));
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
      .setName(t("settings_syncplans_button_5_only_change"))
      .setDesc(t("settings_syncplans_desc"))
      .addButton(async (button) => {
        button.setButtonText("Export");
        button.onClick(async () => {
          await exportVaultSyncPlansToFiles(
            plugin.db,
            plugin.app.vault,
            plugin.vaultRandomID,
            5,
            true
          );
          new Notice(t("settings_syncplans_notice"));
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_syncplans_button_1"))
      .setDesc(t("settings_syncplans_desc"))
      .addButton(async (button) => {
        button.setButtonText("Export");
        button.onClick(async () => {
          await exportVaultSyncPlansToFiles(
            plugin.db,
            plugin.app.vault,
            plugin.vaultRandomID,
            1,
            false
          );
          new Notice(t("settings_syncplans_notice"));
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_syncplans_button_5"))
      .setDesc(t("settings_syncplans_desc"))
      .addButton(async (button) => {
        button.setButtonText("Export");
        button.onClick(async () => {
          await exportVaultSyncPlansToFiles(
            plugin.db,
            plugin.app.vault,
            plugin.vaultRandomID,
            5,
            false
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

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_results"))
      .setDesc(t("settings_profiler_results_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_profiler_results_button_all"));
        button.onClick(async () => {
          await exportVaultProfilerResultsToFiles(
            plugin.db,
            plugin.app.vault,
            plugin.vaultRandomID
          );
          new Notice(t("settings_profiler_results_notice"));
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_enableprofiler"))
      .setDesc(t("settings_profiler_enableprofiler_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("enable", t("enable"));
        dropdown.addOption("disable", t("disable"));
        dropdown
          .setValue(plugin.settings.profiler?.enable ? "enable" : "disable")
          .onChange(async (val: string) => {
            if (plugin.settings.profiler === undefined) {
              plugin.settings.profiler = DEFAULT_PROFILER_CONFIG;
            }
            plugin.settings.profiler.enable = val === "enable";
            await plugin.saveSettings();
          });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_enabledebugprint"))
      .setDesc(t("settings_profiler_enabledebugprint_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("enable", t("enable"));
        dropdown.addOption("disable", t("disable"));
        dropdown
          .setValue(
            plugin.settings.profiler?.enablePrinting ? "enable" : "disable"
          )
          .onChange(async (val: string) => {
            if (plugin.settings.profiler === undefined) {
              plugin.settings.profiler = DEFAULT_PROFILER_CONFIG;
            }
            plugin.settings.profiler.enablePrinting = val === "enable";
            await plugin.saveSettings();
          });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_recordsize"))
      .setDesc(t("settings_profiler_recordsize_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("enable", t("enable"));
        dropdown.addOption("disable", t("disable"));
        dropdown
          .setValue(plugin.settings.profiler?.recordSize ? "enable" : "disable")
          .onChange(async (val: string) => {
            if (plugin.settings.profiler === undefined) {
              plugin.settings.profiler = DEFAULT_PROFILER_CONFIG;
            }
            plugin.settings.profiler.recordSize = val === "enable";
            await plugin.saveSettings();
          });
      });
  });

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
