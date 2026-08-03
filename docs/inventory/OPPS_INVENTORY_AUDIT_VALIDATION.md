# OPPS Inventory Audit Validation Results

This is the validation companion to `OPPS_INVENTORY_AUDIT.md`, recorded on 2026-07-26.

| Command | Result |
| --- | --- |
| `npm.cmd run build` | **Passed** (exit 0). Vite emitted only dependency-age notices for `baseline-browser-mapping` and Browserslist data. |
| `npm.cmd run lint` | **Failed on the existing worktree** (exit 1): 218 problems — 176 errors and 42 warnings. The failures span pre-existing source files; examples include unused React imports and a parser error in `src/components/calculator/MultiPrintCalculator.jsx:446`. `Inventory.jsx` has one existing unused React import error. The audit changed no JS/JSX. |
| `npm.cmd run typecheck` | **Failed on the existing worktree** (exit 1): approximately 3,950 output lines of existing JavaScript/JSX typing errors, including generic `dataClient.entities` typing and UI component prop types. The audit added only Markdown. |
| `npm.cmd run check:xos-boundary` | **Failed on the existing worktree** (exit 1): `[xos-boundary] XosOnlyApp must render XOSAdminShell.` The audit did not touch the XOS boundary. |
| Inventory-specific automated tests | **Not available.** No inventory-specific SQL/JS test or `npm test` script exists in the repository. |

The checked-in SQL tests were inspected but not executed against production because they seed/delete probe records and this task explicitly forbids production-data changes. The read-only data-quality SQL in Section 9 of the main audit is the required next evidence step in an authorized session.

No production data was modified during validation.
