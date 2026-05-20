import { Notice, Setting, type SettingGroup } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../../baseTypes";
import { getClient } from "../../fsGetter";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";
import { ChangeRemoteBaseDirModal } from "../modals";

export function buildS3Section(
  s3Group: SettingGroup,
  plugin: RemotelySavePlugin,
  app: any,
  t: TFunction
) {
  s3Group.addSetting((setting) => {
    setting.setClass("rs-settings-desc-item");
    const frag = document.createDocumentFragment();
    frag.createEl("p", {
      text: t("settings_s3_disclaimer1"),
      cls: "s3-disclaimer",
    });
    setting.setDesc(frag);
  });

  s3Group.addSetting((setting) => {
    setting.setName(t("settings_s3_endpoint")).addText((text) =>
      text
        .setPlaceholder("https://s3.amazonaws.com")
        .setValue(plugin.settings.s3.s3Endpoint)
        .onChange(async (value) => {
          plugin.settings.s3.s3Endpoint = value.trim();
          await plugin.saveSettings();
        })
    );
  });

  s3Group.addSetting((setting) => {
    setting.setName(t("settings_s3_region")).addText((text) =>
      text
        .setPlaceholder("")
        .setValue(plugin.settings.s3.s3Region)
        .onChange(async (value) => {
          plugin.settings.s3.s3Region = value.trim();
          await plugin.saveSettings();
        })
    );
  });

  s3Group.addSetting((setting) => {
    setting.setName(t("settings_s3_accesskeyid")).addText((text) =>
      text
        .setPlaceholder("")
        .setValue(plugin.settings.s3.s3AccessKeyID)
        .onChange(async (value) => {
          plugin.settings.s3.s3AccessKeyID = value.trim();
          await plugin.saveSettings();
        })
    );
  });

  s3Group.addSetting((setting) => {
    setting.setName(t("settings_s3_secretaccesskey")).addText((text) =>
      text
        .setPlaceholder("")
        .setValue(plugin.settings.s3.s3SecretAccessKey)
        .onChange(async (value) => {
          plugin.settings.s3.s3SecretAccessKey = value.trim();
          await plugin.saveSettings();
        })
    );
  });

  s3Group.addSetting((setting) => {
    setting.setName(t("settings_s3_bucketname")).addText((text) =>
      text
        .setPlaceholder("")
        .setValue(plugin.settings.s3.s3BucketName)
        .onChange(async (value) => {
          plugin.settings.s3.s3BucketName = value.trim();
          await plugin.saveSettings();
        })
    );
  });

  s3Group.addSetting((setting) => {
    setting.setName(t("settings_s3_urlstyle")).addDropdown((dropdown) => {
      dropdown.addOption("enable", t("enable"));
      dropdown.addOption("disable", t("disable"));
      dropdown
        .setValue(plugin.settings.s3.forcePathStyle ? "enable" : "disable")
        .onChange(async (val) => {
          plugin.settings.s3.forcePathStyle = val === "enable";
          await plugin.saveSettings();
        });
    });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_s3_generatefolderobject"))
      .addDropdown((dropdown) => {
        dropdown.addOption("enable", t("enable"));
        dropdown.addOption("disable", t("disable"));
        dropdown
          .setValue(
            plugin.settings.s3.generateFolderObject ? "enable" : "disable"
          )
          .onChange(async (val) => {
            plugin.settings.s3.generateFolderObject = val === "enable";
            await plugin.saveSettings();
          });
      });
  });

  let newRemoteBaseDir = plugin.settings.s3.remotePrefix || "";
  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_remoteprefix_s3"))
      .addText((text) =>
        text
          .setPlaceholder(app.vault.getName())
          .setValue(newRemoteBaseDir)
          .onChange((value) => {
            newRemoteBaseDir = value.trim();
          })
      )
      .addButton((button) => {
        button.setButtonText(t("confirm"));
        button.onClick(() => {
          new ChangeRemoteBaseDirModal(
            app,
            plugin,
            newRemoteBaseDir,
            "s3"
          ).open();
        });
      });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_checkonnectivity"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_checkonnectivity_button"));
        button.onClick(async () => {
          new Notice(t("settings_checkonnectivity_checking"));
          const client = getClient(plugin.settings, app.vault.getName(), () =>
            plugin.saveSettings()
          );
          const errors = { msg: "" };
          const res = await client.checkConnect((err: any) => {
            errors.msg = `${err}`;
          });
          if (res) {
            new Notice(t("settings_s3_connect_succ"));
          } else {
            new Notice(t("settings_s3_connect_fail"));
            new Notice(errors.msg);
          }
        });
      });
  });
}
