import { Notice, type Setting, type SettingGroup } from "obsidian";
import type { CipherMethodType } from "../../baseTypes";
import type RemotelySavePlugin from "../../main";
import { stringToFragment } from "../../misc";
import type { TFunction } from "../helpers";
import { wrapTextWithPasswordHide } from "../helpers";
import { EncryptionMethodModal, PasswordModal } from "../modals";

export function buildEncryptionSection(
  group: SettingGroup,
  plugin: RemotelySavePlugin,
  t: TFunction
) {
  let passwordSetting: Setting;
  let encryptionMethodSetting: Setting;

  let newPassword = `${plugin.settings.password}`;
  group.addSetting((setting) => {
    passwordSetting = setting;
    setting
      .setName(t("settings_password"))
      .setDesc(t("settings_password_desc"))
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("")
          .setValue(`${plugin.settings.password}`)
          .onChange(async (value) => {
            newPassword = value.trim();
          });
      })
      .addButton(async (button) => {
        button.setButtonText(t("confirm"));
        button.onClick(async () => {
          new PasswordModal(
            plugin.app,
            plugin,
            newPassword,
            encryptionMethodSetting
          ).open();
        });
      });
  });

  group.addSetting((setting) => {
    encryptionMethodSetting = setting;
    if (plugin.settings.password === "") {
      setting.settingEl.addClass("settings-encryption-method-hide");
    }
    setting
      .setName(t("settings_encryptionmethod"))
      .setDesc(stringToFragment(t("settings_encryptionmethod_desc")))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("rclone-base64", t("settings_encryptionmethod_rclone"))
          .addOption("openssl-base64", t("settings_encryptionmethod_openssl"))
          .setValue(plugin.settings.encryptionMethod ?? "rclone-base64")
          .onChange(async (val: string) => {
            plugin.settings.encryptionMethod = val as CipherMethodType;
            await plugin.saveSettings();
            if (plugin.settings.password !== "") {
              new EncryptionMethodModal(plugin.app, plugin).open();
            }
          });
      });
  });
}
