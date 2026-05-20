import { Eye, EyeOff, createElement } from "lucide";
import { Setting, type TextComponent } from "obsidian";
import type { SUPPORTED_SERVICES_TYPE } from "../baseTypes";
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
