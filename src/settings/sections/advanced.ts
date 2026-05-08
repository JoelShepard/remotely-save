import { Platform, Setting } from "obsidian";
import type { TextComponent } from "obsidian";
import type { ConflictActionType, SyncDirectionType } from "../../baseTypes";
import type RemotelySavePlugin from "../../main";
import { changeMobileStatusBar } from "../../misc";
import { stringToFragment } from "../../misc";
import type { TFunction } from "../helpers";
import { SyncConfigDirModal } from "../modals";

export function buildAdvancedSection(
  advDiv: HTMLElement,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  new Setting(advDiv)
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

  new Setting(advDiv)
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

  new Setting(advDiv)
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

  new Setting(advDiv)
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

  new Setting(advDiv)
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

  const conflictActionSetting = new Setting(advDiv)
    .setName(t("settings_conflictaction"))
    .setDesc(stringToFragment(t("settings_conflictaction_desc")));
  conflictActionSetting.addDropdown((dropdown) => {
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

  const percentage1 = new Setting(advDiv)
    .setName(t("settings_protectmodifypercentage"))
    .setDesc(t("settings_protectmodifypercentage_desc"));

  const percentage2 = new Setting(advDiv)
    .setName(t("settings_protectmodifypercentage_customfield"))
    .setDesc(t("settings_protectmodifypercentage_customfield_desc"));
  if ((plugin.settings.protectModifyPercentage ?? 50) % 10 === 0) {
    percentage2.settingEl.addClass("settings-percentage-custom-hide");
  }
  let percentage2Text: TextComponent | undefined = undefined;
  percentage2.addText((text) => {
    text.inputEl.type = "number";
    percentage2Text = text;
    text
      .setPlaceholder("0 ~ 100")
      .setValue(`${plugin.settings.protectModifyPercentage ?? 50}`)
      .onChange(async (val) => {
        let k = Number.parseFloat(val.trim());
        if (Number.isNaN(k)) {
        } else {
          if (k < 0) {
            k = 0;
          } else if (k > 100) {
            k = 100;
          }
          plugin.settings.protectModifyPercentage = k;
          await plugin.saveSettings();
        }
      });
  });

  percentage1.addDropdown((dropdown) => {
    for (const i of Array.from({ length: 11 }, (x, i) => i * 10)) {
      let desc = `${i}`;
      if (i === 0) {
        desc = t("settings_protectmodifypercentage_000_desc");
      } else if (i === 50) {
        desc = t("settings_protectmodifypercentage_050_desc");
      } else if (i === 100) {
        desc = t("settings_protectmodifypercentage_100_desc");
      }
      dropdown.addOption(`${i}`, desc);
    }
    dropdown.addOption(
      "custom",
      t("settings_protectmodifypercentage_custom_desc")
    );

    const p = plugin.settings.protectModifyPercentage ?? 50;
    let initVal = "custom";
    if (p % 10 === 0) {
      initVal = `${p}`;
    } else {
      percentage2.settingEl.removeClass("settings-percentage-custom");
    }
    dropdown.setValue(initVal).onChange(async (val) => {
      const k = Number.parseInt(val);
      if (val === "custom" || Number.isNaN(k)) {
        percentage2.settingEl.removeClass("settings-percentage-custom-hide");
      } else {
        plugin.settings.protectModifyPercentage = k;
        percentage2.settingEl.addClass("settings-percentage-custom-hide");
        percentage2Text?.setValue(`${k}`);
        await plugin.saveSettings();
      }
    });
  });

  new Setting(advDiv)
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

  if (Platform.isMobile) {
    new Setting(advDiv)
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
  }
}
