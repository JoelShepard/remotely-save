import { Notice, Setting } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../../baseTypes";
import { getClient } from "../../fsGetter";
import type RemotelySavePlugin from "../../main";
import type { TFunction } from "../helpers";
import { wrapTextWithPasswordHide } from "../helpers";
import { ChangeRemoteBaseDirModal } from "../modals";

export function buildWebdisSection(
  body: HTMLElement,
  plugin: RemotelySavePlugin,
  app: any,
  t: TFunction
) {
  const longDescDiv = body.createEl("div", {
    cls: "settings-long-desc",
  });

  longDescDiv.createEl("p", {
    text: t("settings_webdis_disclaimer1"),
    cls: "webdis-disclaimer",
  });
  longDescDiv.createEl("p", { text: t("settings_webdis_disclaimer2") });

  longDescDiv.createEl("p", {
    text: t("settings_webdis_folder", {
      remoteBaseDir:
        plugin.settings.webdis.remoteBaseDir || app.vault.getName(),
    }),
  });

  new Setting(body)
    .setName(t("settings_webdis_addr"))
    .setDesc(t("settings_webdis_addr_desc"))
    .addText((text) =>
      text
        .setPlaceholder("https://")
        .setValue(plugin.settings.webdis.address)
        .onChange(async (value) => {
          plugin.settings.webdis.address = value.trim();
          await plugin.saveSettings();
        })
    );

  new Setting(body)
    .setName(t("settings_webdis_user"))
    .setDesc(t("settings_webdis_user_desc"))
    .addText((text) => {
      wrapTextWithPasswordHide(text);
      text
        .setPlaceholder("")
        .setValue(plugin.settings.webdis.username ?? "")
        .onChange(async (value) => {
          plugin.settings.webdis.username = (value ?? "").trim();
          await plugin.saveSettings();
        });
    });

  new Setting(body)
    .setName(t("settings_webdis_password"))
    .setDesc(t("settings_webdis_password_desc"))
    .addText((text) => {
      wrapTextWithPasswordHide(text);
      text
        .setPlaceholder("")
        .setValue(plugin.settings.webdis.password ?? "")
        .onChange(async (value) => {
          plugin.settings.webdis.password = (value ?? "").trim();
          await plugin.saveSettings();
        });
    });

  let newRemoteBaseDir = plugin.settings.webdis.remoteBaseDir || "";
  new Setting(body)
    .setName(t("settings_remotebasedir"))
    .setDesc(t("settings_remotebasedir_desc"))
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
          "webdis"
        ).open();
      });
    });

  new Setting(body)
    .setName(t("settings_checkonnectivity"))
    .setDesc(t("settings_checkonnectivity_desc"))
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
          new Notice(t("settings_webdis_connect_succ"));
        } else {
          new Notice(t("settings_webdis_connect_fail"));
          new Notice(errors.msg);
        }
      });
    });
}
