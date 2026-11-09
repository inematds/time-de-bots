import { within } from './browser-resilience';
import type { Frame, Locator, Page } from "@cloudflare/playwright";
import type {
  BrowserInspectArguments,
  BrowserScrollArguments,
  BrowserWaitArguments,
} from "./protocol";

const OBSERVABLE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "summary",
  "[role]",
  "[contenteditable='true']",
  "[tabindex]",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "article",
  "tr",
].join(",");

export type BrowserActionEffect = "changed" | "no_effect" | "already_satisfied" | "navigated" | "opened_dialog" | "opened_popup" | "stale_reference" | "blocked" | "uncertain";

export interface BrowserElementObservation {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  dateHint?: string;
  placeholder?: string;
  text?: string;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  checked?: boolean | "mixed";
  scrollable?: boolean;
  visible: boolean;
  frameIndex: number;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface BrowserObservation {
  snapshotId: string;
  fingerprint: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number; maxY: number };
  activeElement?: { role: string; name: string; value?: string };
  dialogs: number;
  elements: BrowserElementObservation[];
  visibleText: string;
  truncated: boolean;
  warnings?: string[];
}

export interface BrowserActionOutcome {
  effect: BrowserActionEffect;
  beforeFingerprint: string;
  afterFingerprint: string;
  changes: string[];
}

export type FillMode = "direct" | "already_satisfied" | "visible_equivalent" | "visible_equivalent_already_satisfied";

export interface FillOutcome {
  mode: FillMode;
  committedDatePicker: boolean;
}

interface RawElementObservation extends Omit<BrowserElementObservation, "ref" | "frameIndex"> {
  locatorIndex: number;
  signature: string;
  interactive: boolean;
}

interface ElementReference {
  snapshotId: string;
  frameIndex: number;
  locatorIndex: number;
  signature: string;
}

export class StaleBrowserReferenceError extends Error {
  constructor() {
    super("The page changed and this element reference is stale; inspect the page again before acting");
    this.name = "StaleBrowserReferenceError";
  }
}

type ClickMode = "pointer";

export async function fillWithVisibleFallback(locator: Locator, page: Page, value: string): Promise<FillOutcome> {
  const identity = await locator.evaluate((node) => ({
    tag: node.tagName.toLowerCase(),
    label: (node.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim(),
    placeholder: (node.getAttribute("placeholder") ?? "").replace(/\s+/g, " ").trim(),
    name: (node.getAttribute("name") ?? "").replace(/\s+/g, " ").trim(),
    type: (node.getAttribute("type") ?? "").replace(/\s+/g, " ").trim(),
  }));
  const priorValue = await locator.inputValue().catch(() => undefined);
  let mode: FillMode;
  if (priorValue === value) {
    mode = "already_satisfied";
  } else if (await locator.isVisible().catch(() => false)) {
    await locator.fill(value, { timeout: 10_000 });
    mode = "direct";
  } else {
    const candidates = page.locator("input,textarea,select");
    const count = await candidates.count();
    let equivalent: Locator | undefined;
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const matches = await candidate.evaluate((node, expected) => {
        const normalized = (raw: string | null) => (raw ?? "").replace(/\s+/g, " ").trim();
        return node.tagName.toLowerCase() === expected.tag
          && normalized(node.getAttribute("aria-label")) === expected.label
          && normalized(node.getAttribute("placeholder")) === expected.placeholder
          && normalized(node.getAttribute("name")) === expected.name
          && normalized(node.getAttribute("type")) === expected.type;
      }, identity).catch(() => false);
      if (matches) {
        equivalent = candidate;
        break;
      }
    }
    if (!equivalent) throw new Error("The field is hidden and no visible equivalent is available");
    if (await equivalent.inputValue().catch(() => undefined) === value) {
      mode = "visible_equivalent_already_satisfied";
    } else {
      await equivalent.fill(value, { timeout: 10_000 });
      mode = "visible_equivalent";
    }
  }

  let committedDatePicker = false;
  if (/^return$/i.test(identity.label || identity.placeholder)) {
    const done = page.getByRole("button", { name: "Done", exact: true }).first();
    if (await done.isVisible().catch(() => false)) {
      await done.click({ timeout: 3_000 });
      committedDatePicker = true;
    }
  }
  return { mode, committedDatePicker };
}

// One requested activation means one trusted click. A response timeout can happen
// after the page has already acted; never replay it through DOM or keyboard.
export async function clickWithDomFallback(locator: Locator, _page?: Page): Promise<ClickMode> {
  await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
  try {
    await locator.click({ timeout: 10_000 });
    return "pointer";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout.*exceeded/i.test(message)) throw new Error(`${message}. The click outcome is uncertain. Inspect the current page before another action; do not repeat a submission blindly.`);
    throw error;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function rawElements(frame: Frame): Promise<RawElementObservation[]> {
  return frame.locator(OBSERVABLE_SELECTOR).evaluateAll((nodes): RawElementObservation[] => {
    const normalized = (value: unknown, maximum = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
    const roleFor = (element: Element): string => {
      const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a") return "link";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "summary") return "button";
      if (/^h[1-6]$/.test(tag)) return "heading";
      if (tag === "li") return "listitem";
      if (tag === "article") return "article";
      if (tag === "tr") return "row";
      if (tag === "input") {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["button", "submit", "reset"].includes(type)) return "button";
        return "textbox";
      }
      return "generic";
    };
    const nameFor = (element: Element): string => {
      const aria = element.getAttribute("aria-label");
      if (aria) return normalized(aria);
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const value = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
        if (normalized(value)) return normalized(value);
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        const labels = [...(element.labels ?? [])].map((label) => label.textContent ?? "").join(" ");
        if (normalized(labels)) return normalized(labels);
        if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.placeholder) return normalized(element.placeholder);
      }
      return normalized(element.getAttribute("title") || element.getAttribute("alt") || element.textContent);
    };
    const dateHintFor = (element: Element): string => {
      const candidates: Element[] = [];
      let current: Element | null = element;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) candidates.push(current);
      const descendant = element.querySelector("[data-iso],[data-date],[data-day],[data-value],[aria-label*='2026'],[aria-label*='2027']");
      if (descendant) candidates.push(descendant);
      for (const candidate of candidates) {
        for (const attribute of [...candidate.attributes]) {
          if (!/(?:date|day|iso|value|label)/i.test(attribute.name)) continue;
          const value = normalized(attribute.value, 120);
          if (/\b20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}\b/.test(value) || /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?\b/i.test(value)) return value;
        }
      }
      return "";
    };
    return nodes.flatMap((node, locatorIndex) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || "1") > 0;
      if (!visible) return [];
      const tag = element.tagName.toLowerCase();
      const role = roleFor(element);
      if (role === "generic" && element.closest("[role='gridcell']") !== element) return [];
      const name = nameFor(element);
      const dateHint = dateHintFor(element);
      const text = normalized(element.innerText || element.textContent);
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : undefined;
      const sensitive = type === "password" || /(?:password|passcode|credit.?card|security.?code|cvv)/i.test(`${name} ${element.getAttribute("autocomplete") ?? ""}`);
      const rawValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? element.value
        : element.getAttribute("aria-valuetext") || element.getAttribute("aria-valuenow") || undefined;
      const value = rawValue === undefined ? undefined : sensitive ? "[redacted]" : normalized(rawValue);
      const interactive = ["button", "textbox", "combobox", "checkbox", "radio", "link", "tab", "option", "menuitem", "switch", "slider"].includes(role)
        || element.matches("button,input,select,textarea,a[href],summary,[contenteditable='true'],[tabindex]");
      const signature = [tag, role, name, type ?? ""].join("|").slice(0, 1_000);
      const checkedValue = element.getAttribute("aria-checked");
      const hasScrollSurface = (candidate: HTMLElement): boolean => {
        const candidateStyle = window.getComputedStyle(candidate);
        return (candidate.scrollHeight > candidate.clientHeight + 1 && /(?:auto|scroll|overlay)/.test(candidateStyle.overflowY))
          || (candidate.scrollWidth > candidate.clientWidth + 1 && /(?:auto|scroll|overlay)/.test(candidateStyle.overflowX));
      };
      let scrollSurface: HTMLElement | null = element;
      for (let depth = 0; scrollSurface && depth < 8 && !hasScrollSurface(scrollSurface); depth += 1) scrollSurface = scrollSurface.parentElement;
      return [{
        locatorIndex,
        signature,
        interactive,
        role,
        name,
        tag,
        ...(type ? { type } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(dateHint ? { dateHint } : {}),
        ...(element.getAttribute("placeholder") ? { placeholder: normalized(element.getAttribute("placeholder")) } : {}),
        ...(text ? { text } : {}),
        ...(element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" ? { disabled: true } : {}),
        ...(element.hasAttribute("aria-expanded") ? { expanded: element.getAttribute("aria-expanded") === "true" } : {}),
        ...(element.hasAttribute("aria-selected") ? { selected: element.getAttribute("aria-selected") === "true" } : {}),
        ...(checkedValue === "true" || checkedValue === "false" || checkedValue === "mixed" ? { checked: checkedValue === "mixed" ? "mixed" : checkedValue === "true" } : {}),
        ...(scrollSurface && hasScrollSurface(scrollSurface) ? { scrollable: true } : {}),
        visible,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      }];
    });
  });
}

export class BrowserAutomation {
  private readonly references = new Map<string, ElementReference>();

  async fingerprint(page: Page): Promise<string> {
    const state = await page.evaluate(() => {
      const dialogCount = [...document.querySelectorAll("dialog,[role='dialog'],[aria-modal='true']")].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }).length;
      const bodyText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 20_000);
      const nestedScroll = [...document.querySelectorAll("[role],dialog")].flatMap((element) => {
        const node = element as HTMLElement;
        return node.scrollTop || node.scrollLeft ? [`${node.tagName}:${node.getAttribute("role") ?? ""}:${Math.round(node.scrollLeft)}:${Math.round(node.scrollTop)}`] : [];
      }).slice(0, 40);
      // Focus alone does not prove that a button, menu or navigation worked.
      // Include visible control values and disclosure state instead.
      const formState=[...document.querySelectorAll('input,textarea,select,[aria-expanded],[aria-checked],[aria-selected]')].flatMap(node=>{
        const e=node as HTMLInputElement,rect=e.getBoundingClientRect();if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight)return[];
        const sensitive=e.type==='password'||/password|passcode|credit.?card|cvv|security.?code/i.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('autocomplete')||''));
        return[[e.tagName,e.getAttribute('aria-label'),sensitive?'[redacted]':e.value,e.checked,e.getAttribute('aria-expanded'),e.getAttribute('aria-checked'),e.getAttribute('aria-selected')]];
      }).slice(0,200);
      return {
        url: location.href,
        title: document.title,
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
        dialogCount,
        nestedScroll,
        formState,
        bodyText,
      };
    });
    return sha256(JSON.stringify(state));
  }

  async observe(page: Page, options: BrowserInspectArguments, budgetMs=6500): Promise<BrowserObservation> {
    const deadline=Date.now()+budgetMs,warnings:string[]=[];
    const snapshotId = `page-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    this.references.clear();
    const frames = page.frames();
    const elements: BrowserElementObservation[] = [];
    for (let frameIndex = 0; frameIndex < Math.min(frames.length,16) && elements.length < options.limit && Date.now()<deadline; frameIndex += 1) {
      const frame = frames[frameIndex];
      if (!frame) continue;
      let candidates: RawElementObservation[];
      try {
        candidates = await within('frame inspection',Math.min(1500,deadline-Date.now()),()=>rawElements(frame));
      } catch {
        warnings.push(`Frame ${frameIndex} did not respond; its controls are omitted.`);
        continue;
      }
      for (const candidate of candidates) {
        if (options.mode === "interactive" && !candidate.interactive) continue;
        if (options.mode === "content" && candidate.interactive) continue;
        const ref = `el-${snapshotId.slice("page-".length)}-${frameIndex}-${candidate.locatorIndex}`;
        this.references.set(ref, {
          snapshotId,
          frameIndex,
          locatorIndex: candidate.locatorIndex,
          signature: candidate.signature,
        });
        const { locatorIndex: _locatorIndex, signature: _signature, interactive: _interactive, ...visible } = candidate;
        elements.push({ ref, frameIndex, ...visible });
        if (elements.length >= options.limit) break;
      }
    }
    const metadata = await within('page inspection',Math.min(2000,Math.max(1,deadline-Date.now())),()=>page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      const normalized = (value: unknown, maximum = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
      const activeRole = active?.getAttribute("role") || (active?.tagName.toLowerCase() === "select" ? "combobox" : active?.tagName.toLowerCase() === "button" ? "button" : active ? "textbox" : "");
      const activeName = active ? normalized(active.getAttribute("aria-label") || active.getAttribute("placeholder") || active.getAttribute("title")) : "";
      const activeValue = active && "value" in active && active.type !== "password" ? normalized(active.value) : undefined;
      const dialogs = [...document.querySelectorAll("dialog,[role='dialog'],[aria-modal='true']")].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }).length;
      const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY), maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) },
        ...(active && activeRole ? { activeElement: { role: activeRole, name: activeName, ...(activeValue !== undefined ? { value: activeValue } : {}) } } : {}),
        dialogs,
        visibleText: text.slice(0, 12_000),
        truncated: text.length > 12_000,
      };
    })).catch(()=>{warnings.push("The page is busy; use the screenshot or inspect again when it settles.");return {viewport:page.viewportSize()||{width:1280,height:800},scroll:{x:0,y:0,maxY:0},dialogs:0,visibleText:'',truncated:true,activeElement:undefined};});
    if(!metadata.visibleText.trim()&&!elements.length)warnings.push('The page is blank or still loading. Wait briefly and inspect again before acting.');
    return {
      snapshotId,
      fingerprint: await within('page fingerprint',Math.min(1500,Math.max(1,deadline-Date.now())),()=>this.fingerprint(page)).catch(()=>sha256(JSON.stringify({url:page.url(),metadata,elements}))),
      url: page.url(),
      title: normalizedText(await within('page title',Math.min(1000,Math.max(1,deadline-Date.now())),()=>page.title()).catch(() => "")).slice(0, 240),
      viewport: metadata.viewport,
      scroll: metadata.scroll,
      ...(metadata.activeElement ? { activeElement: metadata.activeElement } : {}),
      dialogs: metadata.dialogs,
      elements,
      visibleText: metadata.visibleText,
      truncated: metadata.truncated||Date.now()>=deadline,
      ...(warnings.length?{warnings}:{}),
    };
  }

  async locator(page: Page, ref: string): Promise<Locator> {
    const recipe = this.references.get(ref);
    if (!recipe) throw new StaleBrowserReferenceError();
    const frame = page.frames()[recipe.frameIndex];
    if (!frame) throw new StaleBrowserReferenceError();
    const locator = frame.locator(OBSERVABLE_SELECTOR).nth(recipe.locatorIndex);
    if (await locator.count() !== 1) throw new StaleBrowserReferenceError();
    const signature = await locator.evaluate((node) => {
      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();
      const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : "";
      const role = explicit || (tag === "button" ? "button" : tag === "a" ? "link" : tag === "select" ? "combobox" : tag === "textarea" ? "textbox" : tag === "summary" ? "button" : /^h[1-6]$/.test(tag) ? "heading" : tag === "li" ? "listitem" : tag === "article" ? "article" : tag === "tr" ? "row" : tag === "input" ? type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : ["button", "submit", "reset"].includes(type) ? "button" : "textbox" : "generic");
      const normalized = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
      const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
        ? [...(element.labels ?? [])].map((label) => label.textContent ?? "").join(" ")
        : "";
      const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : "";
      const name = normalized(element.getAttribute("aria-label")) || normalized(labelledText) || normalized(labels) || normalized(placeholder) || normalized(element.getAttribute("title") || element.getAttribute("alt") || element.textContent);
      return [tag, role, name, type].join("|").slice(0, 1_000);
    });
    if (signature !== recipe.signature) throw new StaleBrowserReferenceError();
    return locator;
  }

  async click(page: Page, ref: string): Promise<ClickMode> {
    return clickWithDomFallback(await this.locator(page, ref), page);
  }

  async waitForChange(page: Page, beforeFingerprint: string, timeoutMs = 2_500): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let latest = beforeFingerprint;
    let stableChanged = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(150);
      const current = await within('change inspection',Math.min(1000,Math.max(1,deadline-Date.now())),()=>this.fingerprint(page)).catch(()=>latest);
      if (current !== beforeFingerprint) {
        stableChanged = current === latest ? stableChanged + 1 : 1;
        latest = current;
        if (stableChanged >= 2) return current;
      }
    }
    return latest;
  }

  async scroll(page: Page, args: BrowserScrollArguments): Promise<void> {
    const delta = args.direction === "down" ? args.amount : -args.amount;
    if (args.ref) {
      const locator = await this.locator(page, args.ref);
      await locator.evaluate((node, amount) => {
        const hasScrollSurface = (candidate: HTMLElement): boolean => {
          const style = window.getComputedStyle(candidate);
          return (candidate.scrollHeight > candidate.clientHeight + 1 && /(?:auto|scroll|overlay)/.test(style.overflowY))
            || (candidate.scrollWidth > candidate.clientWidth + 1 && /(?:auto|scroll|overlay)/.test(style.overflowX));
        };
        let target: HTMLElement | null = node as HTMLElement;
        for (let depth = 0; target && depth < 8 && !hasScrollSurface(target); depth += 1) target = target.parentElement;
        if (target && hasScrollSurface(target)) target.scrollBy({ top: amount, behavior: "instant" });
        else window.scrollBy({ top: amount, behavior: "instant" });
      }, delta);
      return;
    }
    await page.evaluate((amount) => window.scrollBy({ top: amount, behavior: "instant" }), delta);
  }

  async wait(page: Page, args: BrowserWaitArguments, cancelled:()=>boolean=()=>false): Promise<void> {
    const deadline = Date.now() + args.timeoutMs;
    while (Date.now() <= deadline) {
      if(cancelled())throw new Error('Browser wait paused for manual control.');
      let satisfied = false;
      if (args.condition === "url_contains") satisfied = page.url().includes(args.value!);
      else if (args.condition === "text_visible" || args.condition === "text_hidden") {
        const body = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
        const found = body.toLowerCase().includes(args.value!.toLowerCase());
        satisfied = args.condition === "text_visible" ? found : !found;
      } else if (args.condition === "page_changed") satisfied = await this.fingerprint(page) !== args.fingerprint;
      else {
        try {
          const locator = await this.locator(page, args.ref!);
          if (args.condition === "element_visible") satisfied = await locator.isVisible();
          else if (args.condition === "element_hidden") satisfied = !await locator.isVisible();
          else if (args.condition === "value_equals") satisfied = await locator.inputValue().catch(() => "") === args.value;
        } catch (error) {
          if (args.condition === "element_hidden" && error instanceof StaleBrowserReferenceError) satisfied = true;
          else throw error;
        }
      }
      if (satisfied) return;
      await page.waitForTimeout(150);
    }
    throw new Error(`Timed out waiting for ${args.condition}`);
  }
}
