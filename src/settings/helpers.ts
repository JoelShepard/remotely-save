import { ChevronDown, ChevronRight, Eye, EyeOff, createElement } from "lucide";
import {
  Modal,
  Notice,
  Setting,
  type SettingGroup,
  type TextComponent,
} from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../baseTypes";
import type { TransItemType } from "../i18n";
import type RemotelySavePlugin from "../main";

export type TFunction = (key: TransItemType, vars?: any) => string;

const getEyesElements = () => {
  const eyeEl = createElement(Eye);
  const eyeOffEl = createElement(EyeOff);
  return {
    eye: eyeEl.outerHTML,
    eyeOff: eyeOffEl.outerHTML,
  };
};

export const wrapTextWithPasswordHide = (text: TextComponent) => {
  const { eye, eyeOff } = getEyesElements();
  const hider = text.inputEl.insertAdjacentElement("afterend", createSpan())!;
  hider.innerHTML = eyeOff;
  hider.addEventListener("click", (e) => {
    const isText = text.inputEl.getAttribute("type") === "text";
    hider.innerHTML = isText ? eyeOff : eye;
    text.inputEl.setAttribute("type", isText ? "password" : "text");
    text.inputEl.focus();
  });

  text.inputEl.setAttribute("type", "password");
  return text;
};

/** Render a service selector card */
export function renderServiceCard(
  container: HTMLElement,
  serviceType: SUPPORTED_SERVICES_TYPE,
  iconSvg: string,
  label: string,
  isSelected: boolean,
  onClick: () => void
): HTMLElement {
  const card = container.createEl("div", {
    cls: `rs-service-card${isSelected ? " rs-service-card-selected" : ""}`,
  });
  card.innerHTML = iconSvg;
  card.createEl("span", { text: label });
  card.addEventListener("click", onClick);
  return card;
}

export function injectStyles(_containerEl: HTMLElement) {
  // Styles are now in styles.css — this is kept as a hook for future dynamic styles
}

// ── Collapsible Setting Groups ──

/**
 * Make a SettingGroup collapsible by adding a toggle chevron to its heading.
 * The wrapperEl should be a div created with createDiv() that contains the
 * SettingGroup's heading and settings.
 * The collapsed state is persisted in plugin.settings.collapsedGroups.
 */
export function makeGroupCollapsible(
  wrapperEl: HTMLElement,
  plugin: RemotelySavePlugin,
  groupKey: string
): void {
  // Find the heading inside the wrapper
  const headingEl = wrapperEl.querySelector<HTMLElement>(
    ".setting-group-header h3, .setting-group-header h4"
  );
  if (!headingEl) return;

  const isCollapsed = plugin.settings.collapsedGroups?.[groupKey] ?? false;

  // Add chevron icon before the heading text
  const chevronEl = createElement(isCollapsed ? ChevronRight : ChevronDown);
  chevronEl.classList.add("rs-group-chevron");
  headingEl.prepend(chevronEl);

  // Set initial collapsed state
  if (isCollapsed) {
    wrapperEl.classList.add("rs-group-collapsed");
  }

  // Toggle on heading click
  headingEl.style.cursor = "pointer";
  headingEl.addEventListener("click", async (evt: MouseEvent) => {
    // Only toggle when clicking the heading itself, not a link inside it
    if ((evt.target as HTMLElement).tagName === "A") return;

    const currentlyCollapsed =
      wrapperEl.classList.contains("rs-group-collapsed");
    if (currentlyCollapsed) {
      wrapperEl.classList.remove("rs-group-collapsed");
      // Replace chevron
      const existingChevron = wrapperEl.querySelector(".rs-group-chevron");
      if (existingChevron) {
        existingChevron.outerHTML = createElement(ChevronDown).outerHTML;
        wrapperEl
          .querySelector(".rs-group-chevron")
          ?.classList.add("rs-group-chevron");
      }
    } else {
      wrapperEl.classList.add("rs-group-collapsed");
      const existingChevron = wrapperEl.querySelector(".rs-group-chevron");
      if (existingChevron) {
        existingChevron.outerHTML = createElement(ChevronRight).outerHTML;
        wrapperEl
          .querySelector(".rs-group-chevron")
          ?.classList.add("rs-group-chevron");
      }
    }

    // Persist
    if (!plugin.settings.collapsedGroups) {
      plugin.settings.collapsedGroups = {};
    }
    plugin.settings.collapsedGroups[groupKey] = !currentlyCollapsed;
    await plugin.saveSettings();
  });
}

// ── Inline Validation ──

export type ValidationRule = {
  test: (value: string) => boolean;
  message: string;
};

/**
 * Adds real-time validation to a TextComponent input.
 * Shows a red border + tooltip on invalid, green border on valid (if non-empty).
 */
export function addValidation(
  text: TextComponent,
  rules: ValidationRule[],
  options?: { validateOnBlurOnly?: boolean }
): void {
  const el = text.inputEl;

  const validate = () => {
    const value = el.value.trim();
    if (value === "") {
      el.setCustomValidity("");
      el.classList.remove("rs-valid", "rs-invalid");
      el.title = "";
      return;
    }

    for (const rule of rules) {
      if (!rule.test(value)) {
        el.setCustomValidity(rule.message);
        el.classList.add("rs-invalid");
        el.classList.remove("rs-valid");
        el.title = rule.message;
        return;
      }
    }

    el.setCustomValidity("");
    el.classList.remove("rs-invalid");
    el.classList.add("rs-valid");
    el.title = "";
  };

  if (options?.validateOnBlurOnly) {
    el.addEventListener("blur", validate);
  } else {
    el.addEventListener("input", validate);
    el.addEventListener("blur", validate);
  }

  // Run initial validation
  validate();
}

/** S3-specific validation rules */
export const s3EndpointRule: ValidationRule = {
  test: (v: string) => {
    if (v === "") return true;
    try {
      const url =
        v.startsWith("http://") || v.startsWith("https://")
          ? v
          : `https://${v}`;
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  message: "Must be a valid URL (e.g., https://s3.amazonaws.com)",
};

export const s3BucketNameRule: ValidationRule = {
  test: (v: string) => /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v),
  message:
    "Bucket name must be 3-63 characters, lowercase letters, numbers, dots, and hyphens only",
};

export const s3AccessKeyRule: ValidationRule = {
  test: (v: string) => v.length >= 16 || v === "",
  message: "Access key ID is too short (expected 16+ characters)",
};

export const s3SecretKeyRule: ValidationRule = {
  test: (v: string) => v.length >= 8 || v === "",
  message: "Secret access key is too short",
};

export const s3RegionRule: ValidationRule = {
  test: (v: string) => /^[a-z]{2}-[a-z]+-[0-9]+$/.test(v) || v === "",
  message: "Region format should be like 'us-east-1'",
};

/** WebDAV-specific validation rules */
export const urlRule: ValidationRule = {
  test: (v: string) => {
    if (v === "") return true;
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  },
  message: "Must be a valid URL (e.g., https://example.com/webdav)",
};

// ── Connection Test Result Modal ──

interface ConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  details?: string;
  error?: string;
}

export class ConnectionTestResultModal extends Modal {
  private result: ConnectionTestResult;
  private serviceType: string;

  constructor(app: any, serviceType: string, result: ConnectionTestResult) {
    super(app);
    this.serviceType = serviceType;
    this.result = result;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const icon = this.result.success ? "✅" : "❌";
    const titleText = this.result.success
      ? `Connection to ${this.serviceType} successful`
      : `Connection to ${this.serviceType} failed`;

    this.titleEl.setText(`${icon} ${titleText}`);

    if (this.result.latencyMs !== undefined) {
      contentEl.createEl("p", {
        text: `Latency: ${this.result.latencyMs}ms`,
        cls: this.result.success
          ? "rs-connection-latency-ok"
          : "rs-connection-latency-fail",
      });
    }

    if (this.result.details) {
      contentEl.createEl("p", { text: this.result.details });
    }

    if (this.result.error) {
      const errorEl = contentEl.createEl("pre", {
        text: this.result.error,
        cls: "rs-connection-error",
      });
      errorEl.style.whiteSpace = "pre-wrap";
      errorEl.style.wordBreak = "break-word";
    }

    if (this.result.success) {
      contentEl.createEl("p", {
        text: "You can close this window and start syncing.",
        cls: "rs-connection-success-hint",
      });
    } else {
      const suggestions = this.getSuggestions();
      if (suggestions.length > 0) {
        const listEl = contentEl.createEl("ul");
        for (const s of suggestions) {
          listEl.createEl("li", { text: s });
        }
      }
    }

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText("Close");
      btn.onClick(() => this.close());
    });
  }

  private getSuggestions(): string[] {
    const suggestions: string[] = [];
    if (this.serviceType === "S3") {
      suggestions.push(
        "Verify the endpoint URL is correct and the bucket exists"
      );
      suggestions.push(
        "Make sure the Access Key ID and Secret Access Key have permissions for ListBucket, GetObject, PutObject, DeleteObject"
      );
      suggestions.push(
        "Check CORS configuration on your S3-compatible provider"
      );
      if (this.result.error?.includes("403")) {
        suggestions.push("HTTP 403: Check access keys and bucket permissions");
      }
      if (this.result.error?.includes("404")) {
        suggestions.push("HTTP 404: Check that the bucket name is correct");
      }
      if (this.result.error?.includes("301")) {
        suggestions.push(
          "HTTP 301: Try enabling 'Force path style' or check region"
        );
      }
    } else if (this.serviceType === "WebDAV") {
      suggestions.push(
        "Verify the server address URL is correct and accessible"
      );
      suggestions.push(
        "Check username and password are correct for the WebDAV server"
      );
      suggestions.push(
        "Ensure the remote directory exists or the server allows directory creation"
      );
      suggestions.push("Check CORS configuration if using Obsidian on desktop");
    }
    return suggestions;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
