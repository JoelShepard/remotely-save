import { type App, Modal, Notice, Setting } from "obsidian";
import type {
  CipherMethodType,
  QRExportType,
  SUPPORTED_SERVICES_TYPE,
} from "../baseTypes";
import type { TransItemType } from "../i18n";
import { exportQrCodeUri, parseUriByHand } from "../importExport";
import type RemotelySavePlugin from "../main";
import { checkHasSpecialCharForDir, stringToFragment } from "../misc";

export class PasswordModal extends Modal {
  plugin: RemotelySavePlugin;
  newPassword: string;
  encryptionMethodSetting: Setting;
  constructor(
    app: App,
    plugin: RemotelySavePlugin,
    newPassword: string,
    encryptionMethodSetting: Setting
  ) {
    super(app);
    this.plugin = plugin;
    this.newPassword = newPassword;
    this.encryptionMethodSetting = encryptionMethodSetting;
  }

  onOpen() {
    const { contentEl } = this;

    const t = (x: TransItemType, vars?: Record<string, string>) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("h2", { text: t("modal_password_title") });
    t("modal_password_shortdesc")
      .split("\n")
      .forEach((val: string) => {
        contentEl.createEl("p", {
          text: val,
        });
      });

    [
      t("modal_password_attn1"),
      t("modal_password_attn2"),
      t("modal_password_attn3"),
      t("modal_password_attn4"),
      t("modal_password_attn5"),
    ].forEach((val: string, idx: number) => {
      if (idx < 3) {
        contentEl.createEl("p", {
          text: val,
          cls: "password-disclaimer",
        });
      } else {
        contentEl.createEl("p", {
          text: val,
        });
      }
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t("modal_password_secondconfirm"));
        button.onClick(async () => {
          this.plugin.settings.password = this.newPassword;
          if (this.newPassword !== "") {
            this.encryptionMethodSetting.settingEl.removeClass(
              "settings-encryption-method-hide"
            );
          } else {
            this.encryptionMethodSetting.settingEl.addClass(
              "settings-encryption-method-hide"
            );
          }

          await this.plugin.saveSettings();
          new Notice(t("modal_password_notice"));
          this.close();
        });
        button.setClass("password-second-confirm");
      })
      .addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => {
          this.close();
        });
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class EncryptionMethodModal extends Modal {
  plugin: RemotelySavePlugin;
  constructor(app: App, plugin: RemotelySavePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;

    const t = (x: TransItemType, vars?: Record<string, string>) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("h2", { text: t("modal_encryptionmethod_title") });
    t("modal_encryptionmethod_shortdesc")
      .split("\n")
      .forEach((val: string) => {
        contentEl.createEl("p", {
          text: stringToFragment(val),
        });
      });

    new Setting(contentEl).addButton((button) => {
      button.setButtonText(t("confirm"));
      button.onClick(async () => {
        this.close();
      });
      button.setClass("encryptionmethod-second-confirm");
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class ChangeRemoteBaseDirModal extends Modal {
  readonly plugin: RemotelySavePlugin;
  readonly newRemoteBaseDir: string;
  readonly service: SUPPORTED_SERVICES_TYPE;
  constructor(
    app: App,
    plugin: RemotelySavePlugin,
    newRemoteBaseDir: string,
    service: SUPPORTED_SERVICES_TYPE
  ) {
    super(app);
    this.plugin = plugin;
    this.newRemoteBaseDir = newRemoteBaseDir;
    this.service = service;
  }

  onOpen() {
    const { contentEl } = this;

    const t = (x: TransItemType, vars?: Record<string, string>) => {
      return this.plugin.i18n.t(x, vars);
    };

    const isS3 = this.service === "s3";
    const titleKey = isS3
      ? "modal_remoteprefix_s3_title"
      : "modal_remotebasedir_title";
    const descKey = isS3
      ? "modal_remoteprefix_s3_shortdesc"
      : "modal_remotebasedir_shortdesc";

    contentEl.createEl("h2", { text: t(titleKey) });
    t(descKey)
      .split("\n")
      .forEach((val: string) => {
        contentEl.createEl("p", {
          text: val,
        });
      });

    if (
      this.newRemoteBaseDir === "" ||
      this.newRemoteBaseDir === this.app.vault.getName()
    ) {
      new Setting(contentEl)
        .addButton((button) => {
          const btnText = isS3
            ? t("modal_remoteprefix_s3_secondconfirm_empty")
            : t("modal_remotebasedir_secondconfirm_vaultname");
          button.setButtonText(btnText);
          button.onClick(async () => {
            if (isS3) {
              this.plugin.settings.s3.remotePrefix = "";
            } else {
              (this.plugin.settings as any)[this.service].remoteBaseDir = "";
            }
            await this.plugin.saveSettings();
            const noticeKey = isS3
              ? "modal_remoteprefix_s3_notice"
              : "modal_remotebasedir_notice";
            new Notice(t(noticeKey));
            this.close();
          });
          button.setClass("remotebasedir-second-confirm");
        })
        .addButton((button) => {
          button.setButtonText(t("goback"));
          button.onClick(() => {
            this.close();
          });
        });
    } else if (checkHasSpecialCharForDir(this.newRemoteBaseDir)) {
      const hintKey = isS3
        ? "modal_remoteprefix_s3_invaliddirhint"
        : "modal_remotebasedir_invaliddirhint";
      contentEl.createEl("p", {
        text: t(hintKey),
      });
      new Setting(contentEl).addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => {
          this.close();
        });
      });
    } else {
      new Setting(contentEl)
        .addButton((button) => {
          const btnText = isS3
            ? t("modal_remoteprefix_s3_secondconfirm_change")
            : t("modal_remotebasedir_secondconfirm_change");
          button.setButtonText(btnText);
          button.onClick(async () => {
            if (isS3) {
              this.plugin.settings.s3.remotePrefix = this.newRemoteBaseDir;
            } else {
              (this.plugin.settings as any)[this.service].remoteBaseDir =
                this.newRemoteBaseDir;
            }
            await this.plugin.saveSettings();
            const noticeKey = isS3
              ? "modal_remoteprefix_s3_notice"
              : "modal_remotebasedir_notice";
            new Notice(t(noticeKey));
            this.close();
          });
          button.setClass("remotebasedir-second-confirm");
        })
        .addButton((button) => {
          button.setButtonText(t("goback"));
          button.onClick(() => {
            this.close();
          });
        });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class SyncConfigDirModal extends Modal {
  plugin: RemotelySavePlugin;
  saveDropdownFunc: () => void;
  constructor(
    app: App,
    plugin: RemotelySavePlugin,
    saveDropdownFunc: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.saveDropdownFunc = saveDropdownFunc;
  }

  async onOpen() {
    const { contentEl } = this;

    const t = (x: TransItemType, vars?: Record<string, string>) => {
      return this.plugin.i18n.t(x, vars);
    };

    t("modal_syncconfig_attn")
      .split("\n")
      .forEach((val: string) => {
        contentEl.createEl("p", {
          text: val,
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t("modal_syncconfig_secondconfirm"));
        button.onClick(async () => {
          this.plugin.settings.syncConfigDir = true;
          await this.plugin.saveSettings();
          this.saveDropdownFunc();
          new Notice(t("modal_syncconfig_notice"));
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => {
          this.close();
        });
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class ExportSettingsQrCodeModal extends Modal {
  plugin: RemotelySavePlugin;
  exportType: QRExportType;
  constructor(app: App, plugin: RemotelySavePlugin, exportType: QRExportType) {
    super(app);
    this.plugin = plugin;
    this.exportType = exportType;
  }

  async onOpen() {
    const { contentEl } = this;

    const t = (x: TransItemType, vars?: Record<string, string>) => {
      return this.plugin.i18n.t(x, vars);
    };

    const { rawUri, imgUri } = await exportQrCodeUri(
      this.plugin.settings,
      this.app.vault.getName(),
      this.plugin.manifest.version,
      this.exportType
    );

    const div1 = contentEl.createDiv();
    t("modal_qr_shortdesc")
      .split("\n")
      .forEach((val: string) => {
        div1.createEl("p", {
          text: val,
        });
      });

    const div2 = contentEl.createDiv();
    div2.createEl(
      "button",
      {
        text: t("modal_qr_button"),
      },
      (el) => {
        el.onclick = async () => {
          await navigator.clipboard.writeText(rawUri);
          new Notice(t("modal_qr_button_notice"));
        };
      }
    );

    const div3 = contentEl.createDiv();
    div3.createEl(
      "img",
      {
        cls: "qrcode-img",
      },
      async (el) => {
        el.src = imgUri;
      }
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
