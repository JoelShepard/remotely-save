import { Eye, EyeOff, createElement } from "lucide";
import { Setting, type TextComponent } from "obsidian";
import type { TransItemType } from "../i18n";

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

export function injectStyles(containerEl: HTMLElement) {
  const style = containerEl.createEl("style");
  style.textContent = `
.rs-logs-preview {
  width: 100%;
  max-height: 400px;
  font-family: var(--font-monospace);
  font-size: 0.8em;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  padding: 0.5em;
  resize: vertical;
  color: var(--text-normal);
}
.rs-logs-actions {
  display: flex;
  gap: 0.5em;
  flex-wrap: wrap;
  margin-top: 0.5em;
}
.rs-logs-actions select {
  flex: 0 0 auto;
}
`;
}
