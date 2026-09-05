import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const API = "src/api/invoices.js";
const DRAWER = "src/features/invoices/InvoiceDetailDrawer.jsx";
const PAGE = "src/pages/Invoices.jsx";

// Static source assertions — src/api/invoices.js imports the real Supabase
// client via a Vite path alias, so it isn't safely importable under plain
// `node --test`; this matches the pattern used throughout this repo's own
// invoice tests for the same reason.

test("issueInvoiceShare/revokeInvoiceShare/rotateInvoiceShareToken call the exact P3 RPCs, never write share_token directly", async () => {
  const s = await src(API);
  assert.ok(/supabase\.rpc\("issue_invoice", \{\s*p_invoice_id: invoiceId,\s*p_expires_at: null,\s*\}\)/.test(s),
    "issue_invoice called with the invoice id, no client-chosen expiry");
  assert.ok(/supabase\.rpc\("revoke_invoke_share"|supabase\.rpc\("revoke_invoice_share", \{\s*p_invoice_id: invoiceId,\s*\}\)/.test(s),
    "revoke_invoice_share called with the invoice id");
  assert.ok(/supabase\.rpc\("rotate_invoice_share_token", \{\s*p_invoice_id: invoiceId,\s*\}\)/.test(s),
    "rotate_invoice_share_token called with the invoice id");
  assert.ok(!/\.update\(\{[^}]*share_token/.test(s), "no direct .update() ever sets share_token from the client");
  assert.ok(!/\.from\("opps_invoices"\)[^;]*\.update\(\{[^}]*public_visible/.test(s),
    "no direct .update() ever sets public_visible from the client — only the RPCs do");
});

test("buildPublicInvoiceUrl targets the real production X LAB domain, never a preview/staging URL", async () => {
  const s = await src(API);
  assert.ok(s.includes('const PUBLIC_INVOICE_BASE_URL = "https://xlab.jointx.co.za/i";'),
    "exact production host + path, not env-driven (a preview deploy can't point at itself)");
  assert.ok(!/vercel\.app|localhost|tijiamrfnxrbitafiflj/.test(s), "no preview/staging host anywhere in this file");
  const fn = s.match(/export function buildPublicInvoiceUrl\([\s\S]*?\n\}/)[0];
  assert.ok(fn.includes("PUBLIC_INVOICE_BASE_URL"), "the URL builder uses the one constant, not a re-typed literal");
});

test("issue/revoke/rotate RPC failures map to human-readable messages via the same rpcSafetyError pattern every other invoice RPC uses", async () => {
  const s = await src(API);
  assert.ok(s.includes("const INVOICE_SHARE_ERROR_MESSAGES = {"), "dedicated error-message map, matching REOPEN_INVOICE_ERROR_MESSAGES's own pattern");
  const map = s.match(/const INVOICE_SHARE_ERROR_MESSAGES = \{[\s\S]*?\n\};/)[0];
  for (const code of ["INVOICE_NOT_FOUND", "INVOICE_ACCESS_DENIED", "INVOICE_VOID_CANNOT_ISSUE", "INVOICE_SHARE_NOT_ACTIVE"]) {
    assert.ok(map.includes(code), `maps the RPC's own ${code} error code`);
  }
});

test("InvoiceDetailDrawer: an active share is only offered as Copy/Rotate/Revoke when public_visible, not revoked, and not expired", async () => {
  const s = await src(DRAWER);
  const fn = s.match(/function hasActiveShare\(invoice\) \{[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes("invoice.public_visible !== true"));
  assert.ok(fn.includes("invoice.share_revoked_at"));
  assert.ok(fn.includes("invoice.share_expires_at") && fn.includes("Date.now()"));
});

test("InvoiceDetailDrawer: Share invoice is offered only for a non-draft, non-void invoice; the two states (issue vs manage) never show together", async () => {
  const s = await src(DRAWER);
  assert.ok(s.includes("const shareEligible = Boolean(invoice) && !isDraft && invoice.status !== \"void\";"));
  assert.ok(s.includes("{shareEligible && !shareActive && ("), "Share invoice button gated on eligible AND no active share yet");
  assert.ok(s.includes("{shareActive && ("), "Copy/Rotate/Revoke only render once a share is actually active");
});

test("InvoiceDetailDrawer: Revoke link requires confirmation, matching the existing Void pattern; Copy link never calls a mutation (clipboard only)", async () => {
  const s = await src(DRAWER);
  assert.ok(s.includes("onClick={() => setRevokeShareConfirmOpen(true)}"), "Revoke opens a confirm dialog, not an immediate mutation");
  assert.ok(s.includes('title="Revoke public link?"'));
  const copyFn = s.match(/const copyPublicLink = async \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.ok(copyFn.includes("navigator.clipboard.writeText"));
  assert.ok(!/onIssueShare|onRevokeShare|onRotateShare/.test(copyFn), "copying the link never triggers a server mutation");
});

test("InvoiceDetailDrawer: the three new buttons get a 44px mobile tap target without resizing any existing action", async () => {
  const s = await src(DRAWER);
  const newButtonBlock = s.slice(s.indexOf("{shareEligible && !shareActive"), s.indexOf('{["approved", "exported", "imported_to_zoho"]'));
  const h11Count = (newButtonBlock.match(/h-11 rounded-xl text-xs( text-destructive hover:text-destructive)? sm:h-8/g) || []).length;
  assert.equal(h11Count, 4, "all 4 new buttons (Share/Copy/Rotate/Revoke) use the mobile-44px/desktop-8 pattern");
  // every pre-existing "More" action keeps its original h-8-only sizing
  assert.ok(s.includes('onClick={() => openClientInvoice(invoice, true)} className="h-8 rounded-xl text-xs"'), "Client print unchanged");
  assert.ok(s.includes('onClick={printPosInvoiceSummary} className="h-8 rounded-xl text-xs"'), "POS print unchanged");
});

test("Invoices.jsx: new mutations invalidate the same query keys every other invoice mutation does", async () => {
  const s = await src(PAGE);
  for (const name of ["issueShareMutation", "revokeShareMutation", "rotateShareMutation"]) {
    const block = s.match(new RegExp(`const ${name} = useMutation\\(\\{[\\s\\S]*?\\n  \\}\\);`))[0];
    assert.ok(block.includes('queryClient.invalidateQueries({ queryKey: ["invoices"] })'));
    assert.ok(block.includes('queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] })'));
    assert.ok(block.includes("onError:"), `${name} surfaces failures via toast, same as every other mutation here`);
  }
});

test("no new invoice renderer/PDF system introduced — this feature only wires existing RPCs into the existing drawer", async () => {
  const drawer = await src(DRAWER);
  const api = await src(API);
  assert.ok(!/html2canvas|jsPDF|new jsPDF/i.test(drawer + api), "no PDF generation touched by this feature");
  assert.ok(drawer.includes('import ConfirmDialog from "@/components/common/ConfirmDialog"'), "reuses the existing confirm-dialog primitive, no new one added");
});
