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
  let confirmPassword = "";
  let confirmSetting: Setting | undefined;

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
            // Update confirm validation
            if (confirmSetting && confirmPassword !== "") {
              const confirmInput =
                confirmSetting.settingEl.querySelector("input");
              if (confirmInput) {
                if (newPassword !== confirmPassword) {
                  confirmInput.setCustomValidity("Passwords do not match");
                  confirmInput.classList.add("rs-invalid");
                } else {
                  confirmInput.setCustomValidity("");
                  confirmInput.classList.remove("rs-invalid");
                  confirmInput.classList.add("rs-valid");
                }
              }
            }
          });
      })
      .addButton(async (button) => {
        button.setButtonText(t("confirm"));
        button.onClick(async () => {
          // Check password confirmation
          if (newPassword !== "" && confirmPassword !== "") {
            if (newPassword !== confirmPassword) {
              new Notice("Passwords do not match!");
              return;
            }
          }
          new PasswordModal(
            plugin.app,
            plugin,
            newPassword,
            encryptionMethodSetting
          ).open();
        });
      });
  });

  // Password confirmation field
  group.addSetting((setting) => {
    confirmSetting = setting;
    setting
      .setName("Confirm password")
      .setDesc(
        "Re-enter the encryption password to avoid typos. Only needed when changing the password."
      )
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("Re-enter password")
          .setValue("")
          .onChange(async (value) => {
            confirmPassword = value.trim();
            const input = text.inputEl;
            if (confirmPassword !== "" && confirmPassword !== newPassword) {
              input.setCustomValidity("Passwords do not match");
              input.classList.add("rs-invalid");
              input.classList.remove("rs-valid");
            } else if (confirmPassword !== "") {
              input.setCustomValidity("");
              input.classList.remove("rs-invalid");
              input.classList.add("rs-valid");
            } else {
              input.setCustomValidity("");
              input.classList.remove("rs-invalid", "rs-valid");
            }
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
