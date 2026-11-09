import { within, navigateResponsive, captureResponsive } from './browser-resilience';
import { pageLiveView, type LiveViewCache } from "./live-view";
import { acquire, connect, type Browser, type BrowserContext, type Page, type Route, type Request as PlaywrightRequest } from "@cloudflare/playwright";
import { Sandbox } from "@cloudflare/sandbox";
import {
  BrowserAutomation,
  StaleBrowserReferenceError,
  fillWithVisibleFallback,
  type BrowserActionOutcome,
  type BrowserObservation,
} from "./browser-automation";
import {
  browserApplicationFromArgs,
  browserElementRefFromArgs,
  browserFillFromArgs,
  browserInspectFromArgs,
  browserKeyFromArgs,
  browserPointFromArgs,
  browserScrollFromArgs,
  browserSelectFromArgs,
  browserTextFromArgs,
  browserUrlFromArgs,
  browserResourceUrl,
  browserWaitFromArgs,
  type BrowserToolName,
} from "./protocol";

const BROWSER_WIDTH = 1280;
const BROWSER_HEIGHT = 800;
const MAX_FRAME_BYTES = 4_000_000;

export interface BrowserVisualArtifact {
  mimeType: "image/png";
  dataBase64: string;
  sha256: string;
  currentUrl: string;
  pageTitle: string;
  width: number;
  height: number;
  /** Short-lived Cloudflare Browser Live View URL. Never persist this signed URL. */
  liveViewUrl?: string;
}

export type StoredBrowserVisualArtifact = Omit<BrowserVisualArtifact, "liveViewUrl">;

export interface StoredActionResult {
  output: string;
  argumentDigest: string;
  visualArtifact?: StoredBrowserVisualArtifact;
  browserObservation?: BrowserObservation;
  browserOutcome?: BrowserActionOutcome;
}

export interface BrowserActionResult {
  output: string;
  visualArtifact?: BrowserVisualArtifact;
  browserObservation?: BrowserObservation;
  browserOutcome?: BrowserActionOutcome;
}

export type ActionClaim =
  | { kind: "accepted"; receiptId: string }
  | { kind: "in-flight"; receiptId: string }
  | { kind: "conflict"; receiptId: string }
  | { kind: "replay"; receiptId: string; result: StoredActionResult };

export class GratisSandbox extends Sandbox<Env> {
  private readonly gratisEnv: Env;
  private readonly automation = new BrowserAutomation();
  private liveView?: LiveViewCache;
  private controlGeneration=0;
  private networkPolicies=new WeakMap<BrowserContext,{hosts:Set<string>;approved:boolean;ready:Promise<void>}>();
  private browserMutation?: {name:BrowserToolName;page:Page;promise:Promise<void>};
  private browserConnection?: { sessionId: string; browser: Browser };

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.gratisEnv = env;
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS action_receipts (
          action_id TEXT PRIMARY KEY,
          argument_digest TEXT NOT NULL,
          receipt_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('accepted', 'completed')),
          output TEXT,
          visual_artifact_json TEXT,
          structured_result_json TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS browser_control (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          human INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO browser_control(singleton,human) VALUES(1,0);
        CREATE TABLE IF NOT EXISTS browser_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          session_id TEXT,
          allowed_hosts_json TEXT NOT NULL DEFAULT '[]',
          current_url TEXT,
          page_title TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
      const columns = this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(action_receipts)").toArray();
      if (!columns.some((column) => column.name === "visual_artifact_json")) {
        this.ctx.storage.sql.exec("ALTER TABLE action_receipts ADD COLUMN visual_artifact_json TEXT");
      }
      if (!columns.some((column) => column.name === "structured_result_json")) {
        this.ctx.storage.sql.exec("ALTER TABLE action_receipts ADD COLUMN structured_result_json TEXT");
      }
    });
  }

  async claimAction(actionId: string, argumentDigest: string, now: number): Promise<ActionClaim> {
    const prior = this.ctx.storage.sql.exec<{
      argument_digest: string;
      receipt_id: string;
      status: string;
      output: string | null;
      visual_artifact_json: string | null;
      structured_result_json: string | null;
    }>("SELECT argument_digest, receipt_id, status, output, visual_artifact_json, structured_result_json FROM action_receipts WHERE action_id = ?", actionId).toArray()[0];
    if (prior) {
      if (prior.argument_digest !== argumentDigest) return { kind: "conflict", receiptId: prior.receipt_id };
      if (prior.status === "completed" && prior.output !== null) {
        const visualArtifact = prior.visual_artifact_json
          ? JSON.parse(prior.visual_artifact_json) as StoredBrowserVisualArtifact
          : undefined;
        const structured = prior.structured_result_json
          ? JSON.parse(prior.structured_result_json) as Pick<StoredActionResult, "browserObservation" | "browserOutcome">
          : undefined;
        return { kind: "replay", receiptId: prior.receipt_id, result: {
          output: prior.output,
          argumentDigest,
          ...(visualArtifact ? { visualArtifact } : {}),
          ...(structured?.browserObservation ? { browserObservation: structured.browserObservation } : {}),
          ...(structured?.browserOutcome ? { browserOutcome: structured.browserOutcome } : {}),
        } };
      }
      return { kind: "in-flight", receiptId: prior.receipt_id };
    }
    const receiptId = `runner-${crypto.randomUUID().replaceAll("-", "")}`;
    this.ctx.storage.sql.exec(
      "INSERT INTO action_receipts (action_id, argument_digest, receipt_id, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
      actionId,
      argumentDigest,
      receiptId,
      now,
    );
    this.ctx.storage.sql.exec("DELETE FROM action_receipts WHERE created_at < ?", now - 24 * 60 * 60_000);
    return { kind: "accepted", receiptId };
  }

  async completeAction(actionId: string, result: StoredActionResult, now: number): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE action_receipts SET status = 'completed', output = ?, visual_artifact_json = ?, structured_result_json = ?, completed_at = ? WHERE action_id = ? AND argument_digest = ? AND status = 'accepted'",
      result.output,
      result.visualArtifact ? JSON.stringify(result.visualArtifact) : null,
      result.browserObservation || result.browserOutcome ? JSON.stringify({ browserObservation: result.browserObservation, browserOutcome: result.browserOutcome }) : null,
      now,
      actionId,
      result.argumentDigest,
    );
  }

  private humanHasBrowser():boolean {
    return this.ctx.storage.sql.exec<{human:number}>("SELECT human FROM browser_control WHERE singleton=1").toArray()[0]?.human===1;
  }

  async controlBrowser(human?:boolean):Promise<{human:boolean}> {
    if(human===undefined)return{human:this.humanHasBrowser()};
    this.ctx.storage.sql.exec("UPDATE browser_control SET human=? WHERE singleton=1",human?1:0);
    this.controlGeneration++;
    const action=this.browserMutation;
    if(human&&action){
      // A pending navigation can be stopped without closing the browser or clearing its state.
      if(action.name==='browse_url'){
        const cdp=await within('pause navigation',1000,()=>action.page.context().newCDPSession(action.page)).catch(()=>undefined);
        if(cdp){try{await within('pause navigation',1000,()=>cdp.send('Page.stopLoading'));}catch{}finally{await within('pause cleanup',500,()=>cdp.detach()).catch(()=>undefined);}}
      }
      await within('finishing the last browser action',15000,()=>action.promise).catch(error=>{if(this.browserMutation===action)throw error;});
    }
    return{human:this.humanHasBrowser()};
  }

  async executeBrowserAction(
    name: BrowserToolName,
    args: Record<string, unknown>,
    networkAllowlist: string[],
    humanControl = false,
    approvedTarget = false,
  ): Promise<BrowserActionResult> {
    const generation=this.controlGeneration;
    if(!humanControl&&this.humanHasBrowser())throw new Error('The user has control of the browser. Wait for them to give control back.');
    const target = name === "browse_url" ? browserUrlFromArgs(args) : undefined;
    const stored = this.browserState();
    const allowedHosts = new Set([
      ...stored.allowedHosts,
      ...networkAllowlist.flatMap((entry) => {
        try {
          const normalized = entry.trim().replace(/^https?:\/\//i, "").replace(/^\*\./, "").split("/")[0];
          return [new URL(`https://${normalized}`).hostname.toLowerCase()];
        } catch {
          return [];
        }
      }),
      ...(target ? [target.hostname.toLowerCase()] : []),
    ]);
    const started=Date.now(),timings:Record<string,number>={};
    const step=async<T>(stage:string,ms:number,work:()=>Promise<T>)=>{const at=Date.now();let status='ok';try{return await within(stage,ms,work);}catch(error){status='error';throw error;}finally{timings[stage]=Date.now()-at;console.log(JSON.stringify({kind:'gratis_browser',action:name,stage,status,ms:timings[stage]}));}};
    const warnings:string[]=[];
    const browser = await step('connect',12000,()=>this.connectBrowser(stored.sessionId));
    const context = browser.contexts()[0] ?? await step('context',3000,()=>browser.newContext({viewport:{width:BROWSER_WIDTH,height:BROWSER_HEIGHT}}));
    this.saveBrowserState(browser.sessionId(),allowedHosts,'','');
    await step('network boundary',3000,()=>this.installNetworkBoundary(context, allowedHosts, approvedTarget));
    let page = context.pages().at(-1) ?? await step('new page',3000,()=>context.newPage());
    page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(15000);
    await step('viewport',2000,()=>page.setViewportSize({ width: BROWSER_WIDTH, height: BROWSER_HEIGHT }));
    const beforeUrl = page.url();
    const beforePages = context.pages().length;
    const passive=['browse_url','inspect_page','capture_screen','open_application'].includes(name);
    const beforeDialogs = passive?0:await step('dialog inspection',1500,()=>page.locator("dialog,[role='dialog'],[aria-modal='true']").count()).catch(() => 0);
    const beforeFingerprint = passive?'0'.repeat(64):await step('before fingerprint',1500,()=>this.automation.fingerprint(page)).catch(() => '0'.repeat(64));

    if(!humanControl&&(this.humanHasBrowser()||generation!==this.controlGeneration))throw new Error('Browser action paused for manual control.');
    let actionDetail = "Captured the cloud browser.";
    let effectOverride: BrowserActionOutcome["effect"] | undefined;
    const applyAction=async()=>{
    try {
    if (name === "browse_url" && target) {
      warnings.push(...await step('navigate',20000,()=>navigateResponsive(page,target.toString())));
      actionDetail = `Opened ${target.hostname} in the cloud browser.`;
    } else if (name === "inspect_page") {
      browserInspectFromArgs(args);
      actionDetail = "Inspected the current cloud browser page semantically.";
      effectOverride = "already_satisfied";
    } else if (name === "click_element") {
      const ref = browserElementRefFromArgs(args)!;
      await this.automation.click(page, ref);
      actionDetail = `Clicked element ${ref} once.`;
    } else if (name === "fill_field") {
      const input = browserFillFromArgs(args);
      const locator = await this.automation.locator(page, input.ref);
      const fill = await fillWithVisibleFallback(locator, page, input.value);
      if (fill.mode === "already_satisfied" || fill.mode === "visible_equivalent_already_satisfied") effectOverride = "already_satisfied";
      actionDetail = fill.mode.startsWith("visible_equivalent")
        ? `Filled the visible equivalent of ${input.ref} with ${input.value.length} characters${fill.committedDatePicker ? " and committed the completed date range" : ""}.`
        : `Filled ${input.ref} with ${input.value.length} characters${fill.committedDatePicker ? " and committed the completed date range" : ""}.`;
    } else if (name === "press_key") {
      const input = browserKeyFromArgs(args);
      if (input.ref) await (await this.automation.locator(page, input.ref)).press(input.key, { timeout: 10_000 });
      else await page.keyboard.press(input.key);
      actionDetail = `Pressed ${input.key}${input.ref ? ` on ${input.ref}` : " in the active browser control"}.`;
    } else if (name === "select_option") {
      const input = browserSelectFromArgs(args);
      await (await this.automation.locator(page, input.ref)).selectOption(input.value, { timeout: 10_000 });
      actionDetail = `Selected an option in ${input.ref}.`;
    } else if (name === "scroll_page") {
      const input = browserScrollFromArgs(args);
      if(humanControl&&typeof args.x==='number'&&typeof args.y==='number'){const point=browserPointFromArgs(args);await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,input.direction==='down'?input.amount:-input.amount);}else await this.automation.scroll(page, input);
      actionDetail = `Scrolled ${input.direction} ${input.amount} pixels${input.ref ? ` in ${input.ref}` : ""}.`;
    } else if (name === "wait_for") {
      const input = browserWaitFromArgs(args);
      await this.automation.wait(page, input,()=>!humanControl&&(this.humanHasBrowser()||generation!==this.controlGeneration));
      actionDetail = `Wait condition ${input.condition} was satisfied.`;
      effectOverride = "already_satisfied";
    } else if (name === "click_screen") {
      const point = browserPointFromArgs(args);
      await page.mouse.click(point.x, point.y);
      actionDetail = `Clicked ${point.x}, ${point.y} inside the cloud browser.`;
    } else if (name === "type_text") {
      const text = browserTextFromArgs(args);
      await page.keyboard.type(text, { delay: 8 });
      actionDetail = `Typed ${text.length} characters into the active cloud browser control.`;
    } else if (name === "open_application") {
      const application = browserApplicationFromArgs(args);
      actionDetail = application === "browser"
        ? "The Cloudflare browser is open."
        : application === "terminal"
          ? "The cloud terminal is available through run_command; the browser remains visible on the desktop."
          : "The seat's /workspace files are available through the file tools; the browser remains visible on the desktop.";
      effectOverride = "already_satisfied";
    }
    } catch (error) {
      if (!(error instanceof StaleBrowserReferenceError)) throw error;
      actionDetail = error.message;
      effectOverride = "stale_reference";
    }

    };
    const primitive=applyAction();
    const mutation={name,page,promise:primitive};
    if(!['inspect_page','capture_screen','wait_for'].includes(name))this.browserMutation=mutation;
    try{await primitive;}finally{if(this.browserMutation===mutation)this.browserMutation=undefined;}
    if(!humanControl&&(this.humanHasBrowser()||generation!==this.controlGeneration))throw new Error('Browser action paused for manual control.');

    if(!effectOverride&&!passive)await step('settle',3000,()=>this.automation.waitForChange(page,beforeFingerprint)).catch(()=>warnings.push('The page is still changing. Inspect again before repeating an action.'));
    page = context.pages().at(-1) ?? page;
    await step('viewport',2000,()=>page.setViewportSize({ width: BROWSER_WIDTH, height: BROWSER_HEIGHT }));
    const observation = await step('observe',7500,()=>this.automation.observe(page,browserInspectFromArgs(name==='inspect_page'?args:{mode:'both',limit:80})));
    warnings.push(...(observation.warnings||[]));if(warnings.length)observation.warnings=[...new Set(warnings)];
    const currentUrl = page.url();
    const pageTitle = observation.title||this.fallbackTitle(currentUrl);
    const screenshot = await step('capture',8000,()=>captureResponsive(page));
    if (!screenshot.length || screenshot.length > MAX_FRAME_BYTES) throw new Error("The cloud browser returned an invalid or oversized frame");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", screenshot));
    const liveViewUrl = await step('live view',1500,()=>this.browserLiveViewUrl(page,browser.sessionId())).catch(()=>undefined);
    const visualArtifact: BrowserVisualArtifact = {
      mimeType: "image/png",
      dataBase64: this.base64(screenshot),
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      currentUrl,
      pageTitle,
      width: BROWSER_WIDTH,
      height: BROWSER_HEIGHT,
      ...(liveViewUrl ? { liveViewUrl } : {}),
    };
    const afterDialogs = observation.dialogs;
    const afterFingerprint = observation.fingerprint;
    const effect: BrowserActionOutcome["effect"] = effectOverride
      ?? (context.pages().length > beforePages ? "opened_popup"
        : currentUrl !== beforeUrl ? "navigated"
          : afterDialogs > beforeDialogs ? "opened_dialog"
            : afterFingerprint !== beforeFingerprint ? "changed"
              : "no_effect");
    const changes = [
      ...(currentUrl !== beforeUrl ? [`URL changed from ${beforeUrl || "about:blank"} to ${currentUrl}`] : []),
      ...(afterDialogs > beforeDialogs ? ["A dialog became visible"] : []),
      ...(context.pages().length > beforePages ? ["A new browser page opened"] : []),
      ...(effect === "no_effect" ? ["No meaningful page-state change was detected"] : []),
      ...warnings,
      ...(effect === "stale_reference" ? ["The semantic element reference expired; inspect the current page and use a new ref"] : []),
    ];
    const browserOutcome: BrowserActionOutcome = { effect, beforeFingerprint, afterFingerprint, changes };
    this.saveBrowserState(browser.sessionId(), allowedHosts, humanControl ? "" : currentUrl, humanControl ? "" : pageTitle);
    const output = [
      actionDetail,
      ...(warnings.length?[`Page status: partial — ${warnings.join(' ')}`]:[]),
      `Effect: ${effect}`,
      `Frame: ${BROWSER_WIDTH} x ${BROWSER_HEIGHT}`,
      `Title: ${pageTitle}`,
      `URL: ${currentUrl}`,
      `Snapshot: ${observation.snapshotId}`,
      `Fingerprint: ${observation.fingerprint}`,
      `Interactive/content elements:\n${JSON.stringify(observation.elements)}`,
      observation.visibleText ? `\nVisible text:\n${observation.visibleText}` : "\nNo readable page text was found.",
    ].join("\n");
    console.log(JSON.stringify({kind:'gratis_browser',action:name,stage:'complete',ms:Date.now()-started,partial:!!warnings.length,elements:observation.elements.length}));
    return { output, visualArtifact, browserObservation: observation, browserOutcome };
  }

  async disposeBrowser(): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE browser_control SET human=0 WHERE singleton=1");this.controlGeneration++;
    this.liveView=undefined;
    const {sessionId}=this.browserState();
    let browser=this.browserConnection&&this.browserConnection.sessionId===sessionId?this.browserConnection.browser:undefined;
    this.browserConnection=undefined;
    // Forget a failed connection even if its remote Chromium cannot acknowledge close.
    this.ctx.storage.sql.exec("DELETE FROM browser_state WHERE singleton = 1");
    if(sessionId){
      try{await within('close browser',5000,async()=>{
        browser??=await connect(this.gratisEnv.BROWSER,sessionId);
        const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close');
      });}catch{/* An expired or stalled browser must not block a replacement. */}
      finally{await within('disconnect browser',1000,async()=>{await browser?.close();}).catch(()=>{});}
    }
  }

  private browserState(): { sessionId?: string; allowedHosts: string[] } {
    const row = this.ctx.storage.sql.exec<{ session_id: string | null; allowed_hosts_json: string }>(
      "SELECT session_id, allowed_hosts_json FROM browser_state WHERE singleton = 1",
    ).toArray()[0];
    if (!row) return { allowedHosts: [] };
    let allowedHosts: string[] = [];
    try {
      const parsed = JSON.parse(row.allowed_hosts_json) as unknown;
      if (Array.isArray(parsed)) allowedHosts = parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 100);
    } catch {
      // Corrupt browser metadata is discarded without affecting the sandbox receipt ledger.
    }
    return { ...(row.session_id ? { sessionId: row.session_id } : {}), allowedHosts };
  }

  private saveBrowserState(sessionId: string, allowedHosts: Set<string>, currentUrl: string, pageTitle: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_state (singleton, session_id, allowed_hosts_json, current_url, page_title, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET session_id = excluded.session_id, allowed_hosts_json = excluded.allowed_hosts_json,
         current_url = excluded.current_url, page_title = excluded.page_title, updated_at = excluded.updated_at`,
      sessionId,
      JSON.stringify([...allowedHosts].slice(-100)),
      currentUrl.slice(0, 4_000),
      pageTitle.slice(0, 240),
      Date.now(),
    );
  }

  private async connectBrowser(sessionId?: string): Promise<Browser> {
    const active = this.browserConnection;
    if (active && active.browser.isConnected() && (!sessionId || active.sessionId === sessionId)) return active.browser;
    if (active) {
      this.browserConnection = undefined;
      await active.browser.close().catch(() => undefined);
    }
    let browser: Browser;
    if (sessionId) {
      try {
        browser = await connect(this.gratisEnv.BROWSER, sessionId);
        this.browserConnection = { sessionId, browser };
        return browser;
      } catch {
        this.ctx.storage.sql.exec("UPDATE browser_state SET session_id = NULL WHERE singleton = 1");
      }
    }
    const acquired = await acquire(this.gratisEnv.BROWSER, { keep_alive: 600_000 });
    browser = await connect(this.gratisEnv.BROWSER, acquired.sessionId);
    this.browserConnection = { sessionId: acquired.sessionId, browser };
    return browser;
  }

  private async browserLiveViewUrl(page: Page, sessionId: string): Promise<string | undefined> {
    this.liveView = await pageLiveView(page, sessionId, this.liveView);
    return this.liveView?.url;
  }

  private async installNetworkBoundary(context: BrowserContext, allowedHosts: Set<string>, approvedPublicNavigation=false): Promise<void> {
    const existing=this.networkPolicies.get(context);
    if(existing){existing.hosts=allowedHosts;existing.approved=approvedPublicNavigation;await existing.ready;return;}
    const policy={hosts:allowedHosts,approved:approvedPublicNavigation,ready:Promise.resolve()};
    this.networkPolicies.set(context,policy);
    policy.ready=context.route("**/*", async (route: Route, request: PlaywrightRequest) => {
      const value=request.url();
      if(/^(?:data|blob|about):/i.test(value)){await route.continue();return;}
      let url:URL;
      try{url=browserResourceUrl(value);}catch{await route.abort('blockedbyclient');return;}
      const frame=request.frame(),mainNavigation=request.isNavigationRequest()&&frame===frame.page().mainFrame();
      if(mainNavigation&&!policy.approved&&!this.humanHasBrowser()&&!this.hostAllowed(url.hostname,policy.hosts)){await route.abort('blockedbyclient');return;}
      await route.continue();
    });
    try{await policy.ready;}catch(error){this.networkPolicies.delete(context);throw error;}
  }

  private hostAllowed(hostname: string, allowedHosts: Set<string>): boolean {
    const target = hostname.toLowerCase();
    return [...allowedHosts].some((host) => target === host || target.endsWith(`.${host}`));
  }

  private fallbackTitle(value: string): string {
    try {
      return new URL(value).hostname || "Cloud browser";
    } catch {
      return "Cloud browser";
    }
  }

  private base64(bytes: Uint8Array): string {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + 0x8000)));
    }
    return btoa(binary);
  }
}
