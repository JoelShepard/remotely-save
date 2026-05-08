import { Notice, Setting } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE, WebdavAuthType } from "../../baseTypes";
import { VALID_REQURL } from "../../baseTypesObs";
import { getClient } from "../../fsGetter";
import type RemotelySavePlugin from "../../main";
import { stringToFragment } from "../../misc";
import type { TFunction } from "../helpers";
import { wrapTextWithPasswordHide } from "../helpers";
import { ChangeRemoteBaseDirModal } from "../modals";

export function buildWebdavSection(
  webdavBody: HTMLElement,
  plugin: RemotelySavePlugin,
  app: any,
  t: TFunction
) {
  const webdavLongDescDiv = webdavBody.createEl("div", {
    cls: "settings-long-desc",
  });

  webdavLongDescDiv.createEl("p", {
    text: t("settings_webdav_disclaimer1"),
    cls: "webdav-disclaimer",
  });

  if (!VALID_REQURL) {
    webdavLongDescDiv.createEl("p", {
      text: t("settings_webdav_cors_os"),
    });

    webdavLongDescDiv.createEl("p", {
      text: t("settings_webdav_cors"),
    });
  }

  webdavLongDescDiv.createEl("p", {
    text: t("settings_webdav_folder", {
      remoteBaseDir:
        plugin.settings.webdav.remoteBaseDir || app.vault.getName(),
    }),
  });

  const migrateDepthIfAuto = () => {
    if (
      plugin.settings.webdav.depth === "auto" ||
      plugin.settings.webdav.depth === "auto_1" ||
      plugin.settings.webdav.depth === "auto_infinity" ||
      plugin.settings.webdav.depth === "auto_unknown"
    ) {
      plugin.settings.webdav.depth = "manual_1";
    }
  };

  new Setting(webdavBody)
    .setName(t("settings_webdav_addr"))
    .setDesc(t("settings_webdav_addr_desc"))
    .addText((text) =>
      text
        .setPlaceholder("")
        .setValue(plugin.settings.webdav.address)
        .onChange(async (value) => {
          plugin.settings.webdav.address = value.trim();
          migrateDepthIfAuto();
          await plugin.saveSettings();
        })
    );

  new Setting(webdavBody)
    .setName(t("settings_webdav_user"))
    .setDesc(t("settings_webdav_user_desc"))
    .addText((text) => {
      wrapTextWithPasswordHide(text);
      text
        .setPlaceholder("")
        .setValue(plugin.settings.webdav.username)
        .onChange(async (value) => {
          plugin.settings.webdav.username = value.trim();
          migrateDepthIfAuto();
          await plugin.saveSettings();
        });
    });

  new Setting(webdavBody)
    .setName(t("settings_webdav_password"))
    .setDesc(t("settings_webdav_password_desc"))
    .addText((text) => {
      wrapTextWithPasswordHide(text);
      text
        .setPlaceholder("")
        .setValue(plugin.settings.webdav.password)
        .onChange(async (value) => {
          plugin.settings.webdav.password = value.trim();
          migrateDepthIfAuto();
          await plugin.saveSettings();
        });
    });

  new Setting(webdavBody)
    .setName(t("settings_webdav_auth"))
    .setDesc(t("settings_webdav_auth_desc"))
    .addDropdown(async (dropdown) => {
      dropdown.addOption("basic", "basic");
      if (VALID_REQURL) {
        dropdown.addOption("digest", "digest");
      }

      if (!VALID_REQURL && plugin.settings.webdav.authType !== "basic") {
        plugin.settings.webdav.authType = "basic";
        await plugin.saveSettings();
      }

      dropdown
        .setValue(plugin.settings.webdav.authType)
        .onChange(async (val) => {
          plugin.settings.webdav.authType = val as WebdavAuthType;
          await plugin.saveSettings();
        });
    });

  new Setting(webdavBody)
    .setName(t("settings_webdav_depth"))
    .setDesc(t("settings_webdav_depth_desc"))
    .addDropdown((dropdown) => {
      dropdown.addOption("manual_1", t("settings_webdav_depth_1"));
      dropdown.addOption("manual_infinity", t("settings_webdav_depth_inf"));

      dropdown
        .setValue(plugin.settings.webdav.depth || "manual_1")
        .onChange(async (val) => {
          if (val === "manual_1") {
            plugin.settings.webdav.depth = "manual_1";
            plugin.settings.webdav.manualRecursive = true;
          } else if (val === "manual_infinity") {
            plugin.settings.webdav.depth = "manual_infinity";
            plugin.settings.webdav.manualRecursive = false;
          }
          await plugin.saveSettings();
        });
    });

  new Setting(webdavBody)
    .setName(t("settings_webdav_customheaders"))
    .setDesc(stringToFragment(t("settings_webdav_customheaders_desc")))
    .addTextArea((textArea) => {
      textArea
        .setPlaceholder(`X-Header1: Value1\nX-Header2: Value2`)
        .setValue(`${plugin.settings.webdav.customHeaders ?? ""}`)
        .onChange(async (value) => {
          plugin.settings.webdav.customHeaders = value
            .trim()
            .split("\n")
            .filter((x) => x.trim() !== "")
            .join("\n");
          await plugin.saveSettings();
        });
      textArea.inputEl.rows = 10;
      textArea.inputEl.cols = 30;
      textArea.inputEl.addClass("webdav-customheaders-textarea");
    });

  let newWebdavRemoteBaseDir = plugin.settings.webdav.remoteBaseDir || "";
  new Setting(webdavBody)
    .setName(t("settings_remotebasedir"))
    .setDesc(t("settings_remotebasedir_desc"))
    .addText((text) =>
      text
        .setPlaceholder(app.vault.getName())
        .setValue(newWebdavRemoteBaseDir)
        .onChange((value) => {
          newWebdavRemoteBaseDir = value.trim();
        })
    )
    .addButton((button) => {
      button.setButtonText(t("confirm"));
      button.onClick(() => {
        new ChangeRemoteBaseDirModal(
          app,
          plugin,
          newWebdavRemoteBaseDir,
          "webdav"
        ).open();
      });
    });

  new Setting(webdavBody)
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
          new Notice(t("settings_webdav_connect_succ"));
        } else {
          if (VALID_REQURL) {
            new Notice(t("settings_webdav_connect_fail"));
          } else {
            new Notice(t("settings_webdav_connect_fail_withcors"));
          }
          new Notice(errors.msg);
        }
      });
    });
}
