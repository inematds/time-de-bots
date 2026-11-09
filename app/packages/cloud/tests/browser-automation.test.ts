import { describe, expect, test } from "vitest";
import { BrowserAutomation, clickWithDomFallback, fillWithVisibleFallback, StaleBrowserReferenceError } from "../src/browser-automation";
import type { Locator } from "@cloudflare/playwright";
import type { Page } from "@cloudflare/playwright";

function travelPage(): Page {
  const candidates = [
    { locatorIndex: 0, signature: "input|textbox|Where from?|text", interactive: true, role: "textbox", name: "Where from?", tag: "input", type: "text", value: "Montreal", visible: true, bounds: { x: 80, y: 120, width: 260, height: 44 } },
    { locatorIndex: 1, signature: "input|textbox|Where to?|text", interactive: true, role: "textbox", name: "Where to?", tag: "input", type: "text", value: "Istanbul", visible: true, bounds: { x: 360, y: 120, width: 260, height: 44 } },
    { locatorIndex: 2, signature: "button|button|Departure|", interactive: true, role: "button", name: "Departure", tag: "button", text: "Departure", visible: true, bounds: { x: 640, y: 120, width: 170, height: 44 } },
    { locatorIndex: 3, signature: "button|button|December 13, 2026|", interactive: true, role: "button", name: "December 13, 2026", tag: "button", text: "13", dateHint: "2026-12-13", visible: true, bounds: { x: 700, y: 280, width: 42, height: 42 } },
    { locatorIndex: 4, signature: "button|button|Search|", interactive: true, role: "button", name: "Search", tag: "button", text: "Search", visible: true, bounds: { x: 830, y: 120, width: 120, height: 44 } },
    { locatorIndex: 5, signature: "h1|heading|Flight results|", interactive: false, role: "heading", name: "Flight results", tag: "h1", text: "Flight results", visible: true, bounds: { x: 80, y: 400, width: 300, height: 50 } },
  ];
  const locator = {
    evaluateAll: async () => candidates,
    nth: (index: number) => ({
      count: async () => 1,
      evaluate: async () => candidates[index]?.signature,
    }),
  };
  const frame = { locator: () => locator };
  return {
    frames: () => [frame],
    evaluate: async (callback: unknown) => {
      const source = String(callback);
      if (source.includes("maxY")) {
        return { viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, maxY: 900 }, dialogs: 1, visibleText: "Montreal Istanbul Departure December 13, 2026 Search Flight results", truncated: false };
      }
      return { url: "https://fixture.test/flights", title: "Travel fixture", x: 0, y: 0, dialogCount: 1, activeSignature: "", bodyText: "Montreal Istanbul Departure December 13, 2026 Search Flight results" };
    },
    title: async () => "Travel fixture",
    url: () => "https://fixture.test/flights",
  } as unknown as Page;
}

describe("semantic browser observations", () => {
  test("exposes travel controls and date cells as bounded accessible refs", async () => {
    const automation = new BrowserAutomation();
    const page = travelPage();
    const observation = await automation.observe(page, { mode: "both", limit: 20 });

    expect(observation.snapshotId).toMatch(/^page-[a-f0-9]{16}$/);
    expect(observation.elements.map((element) => [element.role, element.name])).toEqual(expect.arrayContaining([
      ["textbox", "Where from?"],
      ["textbox", "Where to?"],
      ["button", "Departure"],
      ["button", "December 13, 2026"],
      ["button", "Search"],
      ["heading", "Flight results"],
    ]));
    const date = observation.elements.find((element) => element.name === "December 13, 2026");
    expect(date?.ref).toMatch(/^el-[a-f0-9]{16}-0-3$/);
    expect(date?.dateHint).toBe("2026-12-13");
    await expect(automation.locator(page, date!.ref)).resolves.toBeTruthy();
  });

  test("expires every old ref when a new page observation is issued", async () => {
    const automation = new BrowserAutomation();
    const page = travelPage();
    const first = await automation.observe(page, { mode: "interactive", limit: 20 });
    const oldRef = first.elements.find((element) => element.name === "Departure")!.ref;
    const second = await automation.observe(page, { mode: "interactive", limit: 20 });
    expect(second.snapshotId).not.toBe(first.snapshotId);
    await expect(automation.locator(page, oldRef)).rejects.toBeInstanceOf(StaleBrowserReferenceError);
  });

  test("dispatches once even when a successful click leaves the URL unchanged", async () => {
    let clicks = 0;
    const locator = { scrollIntoViewIfNeeded: async () => {}, click: async () => { clicks++; } } as unknown as Locator;
    await expect(clickWithDomFallback(locator)).resolves.toBe("pointer");
    expect(clicks).toBe(1);
  });
  test("never repeats a click after a timeout that may follow a committed submission", async () => {
    let submissions = 0;
    const locator = { scrollIntoViewIfNeeded: async () => {}, click: async () => { submissions++; throw new Error("locator.click: Timeout 10000ms exceeded"); } } as unknown as Locator;
    await expect(clickWithDomFallback(locator)).rejects.toThrow("outcome is uncertain");
    expect(submissions).toBe(1);
  });
  test("never bypasses a covering overlay or a disabled target through DOM activation", async () => {
    let domClicks = 0;
    const locator = { scrollIntoViewIfNeeded: async () => {}, click: async () => { throw new Error("Element is disabled"); }, evaluate: async () => { domClicks++; } } as unknown as Locator;
    await expect(clickWithDomFallback(locator)).rejects.toThrow("Element is disabled");
    expect(domClicks).toBe(0);
  });
  test("failed scrolling never dispatches a click", async () => {
    let clicks = 0;
    const locator = { scrollIntoViewIfNeeded: async () => { throw new Error("Element detached"); }, click: async () => { clicks++; } } as unknown as Locator;
    await expect(clickWithDomFallback(locator)).rejects.toThrow("Element detached");
    expect(clicks).toBe(0);
  });

});

describe("resilient field filling", () => {
  test("retargets a hidden duplicate date input to its visible equivalent and commits the range", async () => {
    let visibleFill = "";
    let doneClicks = 0;
    const identity = { tag: "input", label: "Return", placeholder: "Return", name: "", type: "text" };
    const hiddenCandidate = {
      isVisible: async () => false,
    };
    const visibleCandidate = {
      isVisible: async () => true,
      evaluate: async () => true,
      inputValue: async () => "",
      fill: async (value: string) => { visibleFill = value; },
    };
    const locator = {
      evaluate: async () => identity,
      inputValue: async () => "",
      isVisible: async () => false,
    } as unknown as Locator;
    const page = {
      locator: () => ({
        count: async () => 2,
        nth: (index: number) => index === 0 ? hiddenCandidate : visibleCandidate,
      }),
      getByRole: () => ({
        first: () => ({
          isVisible: async () => true,
          click: async () => { doneClicks += 1; },
        }),
      }),
    } as unknown as Page;

    await expect(fillWithVisibleFallback(locator, page, "11/22/2026")).resolves.toEqual({
      mode: "visible_equivalent",
      committedDatePicker: true,
    });
    expect(visibleFill).toBe("11/22/2026");
    expect(doneClicks).toBe(1);
  });

  test("fills a visible field directly without opening unrelated commit controls", async () => {
    let directFill = "";
    const locator = {
      evaluate: async () => ({ tag: "input", label: "Where to?", placeholder: "", name: "", type: "text" }),
      inputValue: async () => "",
      isVisible: async () => true,
      fill: async (value: string) => { directFill = value; },
    } as unknown as Locator;
    const page = {
      getByRole: () => { throw new Error("Done lookup should not occur"); },
    } as unknown as Page;

    await expect(fillWithVisibleFallback(locator, page, "LIS")).resolves.toEqual({
      mode: "direct",
      committedDatePicker: false,
    });
    expect(directFill).toBe("LIS");
  });
});

test('manual takeover interrupts a passive wait before inspecting or waiting again',async()=>{
 const automation=new BrowserAutomation();
 await expect(automation.wait({} as Page,{condition:'url_contains',value:'never',timeoutMs:15000},()=>true)).rejects.toThrow('paused for manual control');
});
