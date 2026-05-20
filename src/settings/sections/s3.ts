import { Notice, Setting, type SettingGroup } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../../baseTypes";
import { getClient } from "../../fsGetter";
import type RemotelySavePlugin from "../../main";
import {
  ConnectionTestResultModal,
  type TFunction,
  addValidation,
  s3AccessKeyRule,
  s3BucketNameRule,
  s3EndpointRule,
  s3RegionRule,
  s3SecretKeyRule,
} from "../helpers";
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
    setting
      .setName(t("settings_s3_endpoint"))
      .setDesc("Must be a valid URL (e.g., https://s3.amazonaws.com)")
      .addText((text) => {
        addValidation(text, [s3EndpointRule]);
        text
          .setPlaceholder("https://s3.amazonaws.com")
          .setValue(plugin.settings.s3.s3Endpoint)
          .onChange(async (value) => {
            plugin.settings.s3.s3Endpoint = value.trim();
            await plugin.saveSettings();
          });
      });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_s3_region"))
      .setDesc("Region format should be like 'us-east-1'")
      .addText((text) => {
        addValidation(text, [s3RegionRule]);
        text
          .setPlaceholder("us-east-1")
          .setValue(plugin.settings.s3.s3Region)
          .onChange(async (value) => {
            plugin.settings.s3.s3Region = value.trim();
            await plugin.saveSettings();
          });
      });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_s3_accesskeyid"))
      .setDesc("Access key ID — typically 20 alphanumeric characters")
      .addText((text) => {
        addValidation(text, [s3AccessKeyRule]);
        text
          .setPlaceholder("AKIAIOSFODNN7EXAMPLE")
          .setValue(plugin.settings.s3.s3AccessKeyID)
          .onChange(async (value) => {
            plugin.settings.s3.s3AccessKeyID = value.trim();
            await plugin.saveSettings();
          });
      });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_s3_secretaccesskey"))
      .setDesc("Secret access key — keep this safe!")
      .addText((text) => {
        addValidation(text, [s3SecretKeyRule]);
        text
          .setPlaceholder("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
          .setValue(plugin.settings.s3.s3SecretAccessKey)
          .onChange(async (value) => {
            plugin.settings.s3.s3SecretAccessKey = value.trim();
            await plugin.saveSettings();
          });
      });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_s3_bucketname"))
      .setDesc(
        "Bucket name: 3-63 characters, lowercase letters, numbers, dots, hyphens"
      )
      .addText((text) => {
        addValidation(text, [s3BucketNameRule]);
        text
          .setPlaceholder("my-vault-bucket")
          .setValue(plugin.settings.s3.s3BucketName)
          .onChange(async (value) => {
            plugin.settings.s3.s3BucketName = value.trim();
            await plugin.saveSettings();
          });
      });
  });

  s3Group.addSetting((setting) => {
    setting
      .setName(t("settings_s3_urlstyle"))
      .setDesc(
        "Whether to force path-style URLs for S3 objects (e.g., https://s3.amazonaws.com/bucket/key instead of https://bucket.s3.amazonaws.com/key)"
      )
      .addDropdown((dropdown) => {
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
      .setDesc(
        "Verify that the S3 endpoint, bucket, and credentials are accessible"
      )
      .addButton(async (button) => {
        button.setButtonText(t("settings_checkonnectivity_button"));
        button.onClick(async () => {
          new Notice(t("settings_checkonnectivity_checking"));
          const startTime = Date.now();
          const client = getClient(plugin.settings, app.vault.getName(), () =>
            plugin.saveSettings()
          );
          const errors = { msg: "" };
          const res = await client.checkConnect((err: any) => {
            errors.msg = `${err}`;
          });
          const latencyMs = Date.now() - startTime;

          new ConnectionTestResultModal(app, "S3", {
            success: res,
            latencyMs,
            details: res
              ? "Successfully listed bucket objects and performed read/write/delete test."
              : undefined,
            error: res ? undefined : errors.msg || "Unknown error",
          }).open();
        });
      });
  });
}
