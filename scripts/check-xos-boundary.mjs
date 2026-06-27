import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const shell = fs.readFileSync("src/pages/XOSAdminShell.jsx", "utf8");
const main = fs.readFileSync("src/main.jsx", "utf8");
const auth = fs.readFileSync("src/lib/AuthContext.jsx", "utf8");
const worker = fs.readFileSync("public/sw.js", "utf8");

function fail(message) {
  console.error(`[xos-boundary] ${message}`);
  process.exit(1);
}

const appFunction = app.match(/function App\(\) \{[\s\S]*?^}/m)?.[0] || "";
if (!appFunction.includes("if (isXosAdminHost())")) {
  fail("App() must check isXosAdminHost() at the top-level.");
}

if (appFunction.indexOf("isXosAdminHost()") > appFunction.indexOf("return <OppsApp />")) {
  fail("App() must return the XOS branch before OppsApp.");
}

const xosOnly = app.match(/function XosOnlyApp\(\) \{[\s\S]*?\n}\n\nfunction OppsApp/)?.[0] || "";
if (!xosOnly.includes("<XOSAdminShell />")) {
  fail("XosOnlyApp must render XOSAdminShell.");
}

for (const forbidden of ["<Router", "NavigationTracker", "GlobalRefreshControl", "PWAInstallPrompt", "VisualEditAgent", "LayoutWrapper"]) {
  if (xosOnly.includes(forbidden)) {
    fail(`XosOnlyApp must not include ${forbidden}.`);
  }
}

if (shell.includes("/SignIn") || shell.includes("useSearchParams") || shell.includes("localStorage") || shell.includes("jx_current_tenant")) {
  fail("XOSAdminShell must not use shared SignIn, query params, localStorage, or jx_current_tenant.");
}

if (!shell.includes("XOS_BOUNDARY_ACTIVE") || !shell.includes("XOS Boundary Active") || !shell.includes("XOS LIVE BUILD e05b880 ACTIVE")) {
  fail("XOSAdminShell must expose the visible live build marker and console boundary marker.");
}

if (!shell.includes("signInWithPassword") || !shell.includes("signInWithOAuth") || !shell.includes("Continue with Google")) {
  fail("XOSAdminShell must own both email/password and Google sign-in.");
}

if (!shell.includes("listXosOrders") || !shell.includes("Read-only demo order progress") || !shell.includes("Available now")) {
  fail("XOS Orders preview must stay inside the XOSAdminShell.");
}

if (!shell.includes("createXosRequest") || !shell.includes("New Request") || !shell.includes("Creates a tenant-scoped request for OPPS review.")) {
  fail("XOS request creation must stay inside the XOSAdminShell.");
}

if (app.includes("get_xos_orders_for_host") || app.includes("listXosOrders") || app.includes("create_xos_request_for_host") || app.includes("createXosRequest")) {
  fail("OPPS app/root must not own XOS module RPCs.");
}

if (!shell.includes("redirectTo: `${window.location.origin}/`") || !shell.includes("window.location.replace(`${window.location.origin}/`)")) {
  fail("XOS sign-in must return to the same XOS host root.");
}

if (!main.includes("const isXosBoundaryHost = isXosAdminHost();") || !main.includes("XOS_PRE_REACT_BOUNDARY_ACTIVE") || !main.includes("document.documentElement.dataset.xosBoundary = 'active'") || !main.includes("disableServiceWorkerForXos") || !main.includes("service_worker_disabled")) {
  fail("main.jsx must disable service worker behavior on XOS hosts.");
}

if (!main.includes("if (isXosBoundaryHost)") || !main.includes("return;")) {
  fail("main.jsx must return before OPPS service worker/push bootstrap on XOS hosts.");
}

if (!auth.includes("!isXosAdminHost()") || !auth.includes("subscribeToPush")) {
  fail("AuthContext must skip push subscription on XOS hosts.");
}

if (!worker.includes("IS_XOS_SERVICE_WORKER_HOST") || !worker.includes("self.registration.unregister()") || !worker.includes("cache: \"no-store\"")) {
  fail("Service worker must unregister and avoid cached app-shell responses on XOS hosts.");
}

console.log("[xos-boundary] ok");
