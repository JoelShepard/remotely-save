import { Notice, Platform, type SettingGroup } from "obsidian";
import { messyConfigToNormal } from "../../configPersist";
import { exportVaultSyncPlansToFiles } from "../../debugMode";
import {
  clearAllPrevSyncRecordByVault,
  clearAllSyncPlanRecords,
  clearErrorRecords,
  destroyDBs,
  getErrorRecords,
  upsertLastFailedSyncTimeByVault,
  upsertLastSuccessSyncTimeByVault,
} from "../../localdb";
import { clearLogs, getLogsAsText } from "../../logManager";
import { LogViewerModal } from "../../logViewerModal";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";

export function buildDebugSection(
  debugGroup: SettingGroup,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  // ── Log Viewer (always visible) ──
  debugGroup.addSetting((setting) => {
    setting
      .setName("📋 Log Viewer")
      .setDesc(
        "Open the in-app log viewer to see real-time logs, filter by level, export, and more."
      )
      .addButton(async (button) => {
        button.setButtonText("Open Log Viewer");
        button.onClick(() => {
          const modal = new LogViewerModal(plugin);
          modal.open();
        });
      });
  });

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

  // ── Error History (always visible) ──
  debugGroup.addSetting((setting) => {
    setting.setHeading().setName("⚠️ Error History");
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName("View recent errors")
      .setDesc(
        "See the last 50 sync errors with categories and recovery status."
      )
      .addButton(async (button) => {
        button.setButtonText("View Errors");
        button.onClick(async () => {
          const errors = await getErrorRecords(plugin.db, plugin.vaultRandomID);
          if (errors.length === 0) {
            new Notice("No errors recorded.");
            return;
          }
          let msg = `Last ${errors.length} errors:\n`;
          for (const err of errors.slice(0, 10)) {
            const d = new Date(err.timestamp).toLocaleString();
            const recovered = err.recovered ? " (recovered)" : "";
            msg += `\n[${d}] [${err.category}]${recovered} ${err.message.slice(0, 120)}`;
          }
          if (errors.length > 10) {
            msg += `\n... and ${errors.length - 10} more`;
          }
          new Notice(msg, 15000);
        });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName("Clear error history")
      .setDesc("Remove all recorded sync error history.")
      .addButton(async (button) => {
        button.setButtonText("Clear");
        button.onClick(async () => {
          await clearErrorRecords(plugin.db, plugin.vaultRandomID);
          new Notice("Error history cleared.");
        });
      });
  });

  // ── Developer-only items ──
  debugGroup.addSetting((setting) => {
    setting.setHeading().setName("🔧 " + t("settings_showdevoptions"));
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_showdevoptions"))
      .setDesc(t("settings_showdevoptions_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(plugin.settings.showDeveloperOptions ?? false)
          .onChange(async (val: boolean) => {
            plugin.settings.showDeveloperOptions = val;
            await plugin.saveSettings();
            // Refresh the settings tab to show/hide dev options
            plugin.settingsTab?.display();
          });
      });
  });

  if (!plugin.settings.showDeveloperOptions) {
    return;
  }

  // ── Profiler ──
  debugGroup.addSetting((setting) => {
    setting.setHeading().setName("⏱️ Profiler");
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_enableprofiler"))
      .setDesc(t("settings_profiler_enableprofiler_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(plugin.settings.profiler?.enable ?? false)
          .onChange(async (val: boolean) => {
            if (plugin.settings.profiler === undefined) {
              plugin.settings.profiler = {
                enable: false,
                enablePrinting: false,
                recordSize: false,
              };
            }
            plugin.settings.profiler.enable = val;
            await plugin.saveSettings();
          });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_enabledebugprint"))
      .setDesc(t("settings_profiler_enabledebugprint_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(plugin.settings.profiler?.enablePrinting ?? false)
          .onChange(async (val: boolean) => {
            if (plugin.settings.profiler === undefined) {
              plugin.settings.profiler = {
                enable: false,
                enablePrinting: false,
                recordSize: false,
              };
            }
            plugin.settings.profiler.enablePrinting = val;
            await plugin.saveSettings();
          });
      });
  });

  debugGroup.addSetting((setting) => {
    setting
      .setName(t("settings_profiler_recordsize"))
      .setDesc(t("settings_profiler_recordsize_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(plugin.settings.profiler?.recordSize ?? false)
          .onChange(async (val: boolean) => {
            if (plugin.settings.profiler === undefined) {
              plugin.settings.profiler = {
                enable: false,
                enablePrinting: false,
                recordSize: false,
              };
            }
            plugin.settings.profiler.recordSize = val;
            await plugin.saveSettings();
          });
      });
  });

  // ── Sync Plans ──
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
