import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const shell = fs.readFileSync("src/pages/XOSAdminShell.jsx", "utf8");

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

if (!shell.includes("redirectTo: `${window.location.origin}/`")) {
  fail("XOS Google sign-in must redirect back to the same XOS host root.");
}

console.log("[xos-boundary] ok");
