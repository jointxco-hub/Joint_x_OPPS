# iMin POS Printing QA

Date: 2026-06-27

## What Was Added

OPPS now has a progressive text-only POS receipt printing path for iMin Android POS devices.

The implementation adds:

- a browser-side iMin printer abstraction
- Order Drawer `Print POS Receipt`
- Invoice Detail Drawer `Print POS Receipt`
- admin Settings `System Tools` tab with `Test POS Printer`
- safe fallback to existing browser print flows when no iMin bridge is available

This does not replace existing browser print, PDF, invoice, or client-facing print routes.

## Files Changed

- `src/lib/pos/iminPrinter.js`
- `src/components/orders/OrderDrawer.jsx`
- `src/features/invoices/InvoiceDetailDrawer.jsx`
- `src/pages/RolesManagement.jsx`
- `docs/IMIN_POS_PRINTING_QA.md`

## Feature Flag

iMin printing is enabled by default unless explicitly disabled.

Disable iMin-specific bridge printing:

```env
VITE_ENABLE_IMIN_PRINTING=false
```

Enable explicitly:

```env
VITE_ENABLE_IMIN_PRINTING=true
```

When disabled or unavailable, OPPS should continue to use existing browser print fallbacks.

## Manual Desktop QA

- Open OPPS in a normal desktop browser.
- Open an order.
- Click `Print POS Receipt`.
- Confirm there is no crash and the browser print summary fallback opens.
- Open an invoice.
- Click `Print POS Receipt`.
- Confirm the browser invoice print fallback opens.
- Go to Settings / `System Tools`.
- Click `Test POS Printer`.
- Confirm there is no crash and a no-bridge toast appears.

## Manual iMin Device QA

- Open OPPS on the iMin POS device.
- Log in.
- Go to Settings / `System Tools`.
- Click `Test POS Printer`.
- Confirm a physical receipt prints.
- Open a real order.
- Click `Print POS Receipt`.
- Confirm a thermal order brief prints.
- Open a real invoice.
- Click `Print POS Receipt`.
- Confirm an invoice summary prints.
- Confirm receipt text is readable and fits the configured paper width.

## Fallback Behavior

If OPPS cannot detect a supported bridge object, printing does not throw.

Current supported bridge names:

- `OPPSPrinter`
- `IminPrinter`
- `iminPrinter`
- `AndroidPrinter`
- `Android`

Current supported bridge methods:

- `printText`
- `print`
- `sendText`
- `printReceipt`
- `printRaw`

Fallbacks:

- Order POS receipt falls back to the existing order browser print summary.
- Invoice POS receipt falls back to the existing browser invoice print route.
- Test POS printer shows a no-bridge toast without crashing.

## Safety Notes

Receipt text is sanitized before printing.

The formatter strips unsafe control characters, redacts token-like URL query values, and replaces `private-upload://...` references with `[private file]`.

Do not print auth tokens, raw private Storage URLs, private upload references, or internal secrets.

## Known Limitations

- A browser web app may still require a native Android wrapper or WebView JavaScript bridge depending on the actual iMin firmware, installed browser, and printer plugin support.
- First milestone is text-only. QR codes, barcodes, images, and raw ESC/POS commands are intentionally not implemented yet.
- Paper width defaults to 58mm. OPPS reads `localStorage["opps:imin-paper-width"] === "80"` for 80mm formatting.
- Repo-wide lint remains blocked by a pre-existing unrelated unused-import backlog.

## Next Step If Browser Bridge Fails

Create a small Android wrapper/WebView app exposing a safe bridge such as:

```js
window.OPPSPrinter.printText(receiptText)
```

The existing OPPS printer service already detects `OPPSPrinter`, so the web implementation should not need a rewrite.
