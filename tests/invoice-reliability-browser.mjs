import { writeFile } from "node:fs/promises";

const cdpBase = process.env.INVOICE_CDP_URL || "http://127.0.0.1:9223";
const appBase = process.env.INVOICE_APP_URL || "http://127.0.0.1:4175";
const evidenceDir = process.env.INVOICE_EVIDENCE_DIR || process.env.TEMP || ".";
const email = process.env.INVOICE_TEST_EMAIL;
const password = process.env.INVOICE_TEST_PASSWORD;
const supabaseKey = process.env.INVOICE_SUPABASE_KEY;

if (!email || !password || !supabaseKey) throw new Error("Synthetic browser-test credentials and local key are required.");

const targets = await fetch(`${cdpBase}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("No Chrome page target is available.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const browserConsoleErrors = [];
const networkFailures = [];
let rpcRequests = 0;
let holdNextRpc = false;
let failItemQueries = false;
let corruptNextRpc = false;

socket.addEventListener("message", async (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }

  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    browserConsoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || "").join(" "));
  }
  if (message.method === "Network.loadingFailed") {
    networkFailures.push(message.params.errorText);
  }
  if (
    message.method === "Network.requestWillBeSent" &&
    message.params.request.method === "POST" &&
    message.params.request.url.includes("/rpc/save_opps_invoice_with_items")
  ) {
    rpcRequests += 1;
  }
  if (message.method === "Fetch.requestPaused") {
    const { requestId, request } = message.params;
    if (failItemQueries && request.url.includes("/rest/v1/opps_invoice_items")) {
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 503,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ message: "Synthetic item query failure" })).toString("base64"),
      });
      return;
    }
    if (corruptNextRpc && request.method === "POST" && request.url.includes("/rpc/save_opps_invoice_with_items")) {
      corruptNextRpc = false;
      const payload = JSON.parse(request.postData || "{}");
      payload.p_items[0].quantity = 0;
      setTimeout(() => send("Fetch.continueRequest", {
        requestId,
        postData: Buffer.from(JSON.stringify(payload)).toString("base64"),
      }).catch(() => {}), 800);
      return;
    }
    if (holdNextRpc && request.url.includes("/rpc/save_opps_invoice_with_items")) {
      holdNextRpc = false;
      setTimeout(() => send("Fetch.continueRequest", { requestId }).catch(() => {}), 1200);
      return;
    }
    await send("Fetch.continueRequest", { requestId });
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result.value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, label, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await delay(200);
  }
  const body = await evaluate("document.body?.innerText?.slice(0, 4000) || ''");
  throw new Error(`Timed out waiting for ${label}. Body: ${body}`);
}

async function clickButton(text, { includes = false } = {}) {
  const clicked = await evaluate(`(() => {
    const wanted = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll('button')].find((node) => {
      const label = (node.innerText || node.textContent || '').trim();
      return ${includes ? "label.includes(wanted)" : "label === wanted"};
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function setInput(selector, value) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Input not found: ${selector}`);
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const path = `${evidenceDir}\\${name}.png`;
  await writeFile(path, Buffer.from(capture.data, "base64"));
  return path;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
await send("Page.navigate", { url: `${appBase}/SignIn?next=/Invoices` });
await waitFor("document.body?.innerText?.includes('Enter your email and password')", "sign-in form", 30_000);
const authenticated = await evaluate(`(async () => {
  const response = await fetch('http://127.0.0.1:54321/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: ${JSON.stringify(supabaseKey)},
      authorization: 'Bearer ' + ${JSON.stringify(supabaseKey)},
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }),
  });
  if (!response.ok) return false;
  const session = await response.json();
  session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
  location.assign('/Invoices');
  return true;
})()`);
if (!authenticated) throw new Error("Local Supabase password authentication failed.");
await waitFor("location.pathname === '/Invoices' && document.body?.innerText?.includes('TEST-A-DRAFT')", "invoice list", 35_000);

const listScreenshot = await screenshot("invoice-reliability-list");
await clickButton("TEST-A-DRAFT", { includes: true });
await waitFor("document.body?.innerText?.includes('Browser Item One') && document.body?.innerText?.includes('Browser Item Two')", "two loaded invoice items");
const loadedItemCount = await evaluate("['Browser Item One','Browser Item Two'].filter((name) => document.body.innerText.includes(name)).length");
const detailScreenshot = await screenshot("invoice-reliability-detail-two-items");

await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await delay(400);
await clickButton("TEST-A-DRAFT", { includes: true });
await waitFor("document.body?.innerText?.includes('Browser Item One') && document.body?.innerText?.includes('Browser Item Two')", "reopened invoice items");
await clickButton("Edit");
await waitFor("document.body?.innerText?.includes('Edit invoice')", "invoice editor");
await clickButton("Continue", { includes: true });
await clickButton("Continue", { includes: true });
await waitFor("document.querySelectorAll('input[type=number]').length >= 2 && [...document.querySelectorAll('input')].some((input) => input.value === 'Browser Item One')", "item editor");
await setInput("input[type=number]", "4");
await clickButton("Continue", { includes: true });
await clickButton("Continue", { includes: true });
await waitFor("[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Save draft')", "save button");

holdNextRpc = true;
const rpcBefore = rpcRequests;
await clickButton("Save draft");
await waitFor("document.body?.innerText?.includes('Saving...')", "visible saving state", 5_000);
const pendingDisabled = await evaluate("[...document.querySelectorAll('button')].filter((button) => button.innerText.includes('Saving...')).every((button) => button.disabled)");
await clickButton("Saving...", { includes: true });
await waitFor("Boolean(document.querySelector('[data-sonner-toast]')) || document.body?.innerText?.includes('Invoice saved')", "save notification", 20_000);
const saveNotification = await evaluate("document.querySelector('[data-sonner-toast]')?.innerText || ''");
if (!saveNotification.includes("Invoice saved")) {
  throw new Error(`Invoice save did not succeed. Notification: ${saveNotification}. Console: ${browserConsoleErrors.join(' | ')}`);
}
const saveRpcCount = rpcRequests - rpcBefore;
const successScreenshot = await screenshot("invoice-reliability-save-success");

await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await delay(400);
failItemQueries = true;
await clickButton("TEST-A-DRAFT", { includes: true });
await waitFor("document.body?.innerText?.includes('Invoice details could not be loaded. Saving has been disabled')", "protected detail failure", 20_000);
const protectedState = await evaluate(`(() => {
  const text = document.body.innerText;
  return {
    retry: [...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Retry'),
    close: [...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Close'),
    readOnly: text.includes('Open read-only summary'),
    editAbsent: ![...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Edit'),
    saveAbsent: ![...document.querySelectorAll('button')].some((button) => button.innerText.includes('Save draft')),
  };
})()`);
const loadFailureNotification = await evaluate("[...document.querySelectorAll('[data-sonner-toast]')].map((toast) => toast.innerText).find((text) => text.includes('could not be loaded')) || ''");
const failureScreenshot = await screenshot("invoice-reliability-protected-load-failure");
failItemQueries = false;
await clickButton("Retry");
await waitFor("document.body?.innerText?.includes('Browser Item One') && document.body?.innerText?.includes('Browser Item Two')", "successful retry", 20_000);
await waitFor("[...document.querySelectorAll('[data-sonner-toast]')].some((toast) => toast.innerText.includes('Invoice details reloaded'))", "retry success notification", 10_000);
const retryNotification = await evaluate("[...document.querySelectorAll('[data-sonner-toast]')].map((toast) => toast.innerText).find((text) => text.includes('Invoice details reloaded')) || ''");

await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await delay(400);
await clickButton("TEST-A-DRAFT", { includes: true });
await waitFor("document.body?.innerText?.includes('Browser Item One') && document.body?.innerText?.includes('Browser Item Two')", "invoice before transaction failure");
await clickButton("Edit");
await waitFor("document.body?.innerText?.includes('Edit invoice')", "failure-test editor");
await clickButton("Continue", { includes: true });
await clickButton("Continue", { includes: true });
await waitFor("[...document.querySelectorAll('input')].some((input) => input.value === 'Browser Item One')", "failure-test item editor");
await setInput("input[type=number]", "5");
await clickButton("Continue", { includes: true });
await clickButton("Continue", { includes: true });
await waitFor("[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Save draft')", "failure-test save button");

corruptNextRpc = true;
const failureRpcBefore = rpcRequests;
await clickButton("Save draft");
await waitFor("document.body?.innerText?.includes('Saving...')", "failure pending state", 5_000);
await waitFor("[...document.querySelectorAll('[data-sonner-toast]')].some((toast) => toast.innerText.includes('invalid quantity or amount'))", "transaction failure notification", 15_000);
const transactionFailureNotification = await evaluate("[...document.querySelectorAll('[data-sonner-toast]')].map((toast) => toast.innerText).find((text) => text.includes('invalid quantity or amount')) || ''");
const transactionFailureState = await evaluate("(() => ({ editorOpen: document.body.innerText.includes('Edit invoice'), enteredQuantityVisible: document.body.innerText.includes('QTY\\n5'), retrySaveAvailable: [...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Save draft') }))()");
const transactionFailureScreenshot = await screenshot("invoice-reliability-transaction-failure");
const transactionFailureRpcCount = rpcRequests - failureRpcBefore;

const result = {
  loadedItemCount,
  reopenedWithBothItems: true,
  pendingDisabled,
  saveRpcCount,
  successToastVisible: true,
  protectedState,
  loadFailureNotification,
  retryReloadedItems: true,
  retryNotification,
  transactionFailureNotification,
  transactionFailureState,
  transactionFailureRpcCount,
  screenshots: [listScreenshot, detailScreenshot, successScreenshot, failureScreenshot, transactionFailureScreenshot],
  browserConsoleErrors: [...new Set(browserConsoleErrors)].slice(0, 20),
  networkFailures: [...new Set(networkFailures)].slice(0, 20),
};

console.log(JSON.stringify(result, null, 2));
socket.close();
