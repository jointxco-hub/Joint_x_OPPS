# OPPS Product UX Style Guide

Use this guide when building OPPS/XOS operational screens. The goal is not decorative minimalism. The goal is fewer decisions, clearer consequences, and faster work on desktop and mobile.

## North Star

OPPS should feel like Apple hardware running a Tesla operations console:

- Calm, premium, and sparse.
- Fast to scan under pressure.
- Obvious what each action changes in the business.
- Minimal typing, but not vague.
- Friendly to real-life messy operations: cash, receipts, runners, supplier trips, client recovery, urgent production.

If a user has to stop and decode the meaning of a field, rename the field or add guided choices.

## Design Principles

1. Put the business object first.
   Start forms with the thing the user naturally names: expense name, order, client, task, product, supplier, request.

2. Ask for context before accounting detail.
   Example for expenses: Name, description, receipt, amount, then finance categorisation.

3. Prefer guided choices over abstract dropdown labels.
   Bad: `link_type`, `allocation`, `production_job`.
   Good: `What is this expense for?` with choices `General`, `Client`, `Order`, `Supplier PO`, `Project`, `Production`.

4. Explain the consequence, not the feature.
   Bad: `Link to order`.
   Good: `Adds the cost to one order's profitability.`

5. Default to the safest low-friction value.
   For expenses, VAT defaults to `No VAT`, payment defaults to `Cash` or `Unknown` depending on capture mode, and incomplete quick captures go to review.

6. Keep controls compact and touchable.
   Use 40-44px control height, rounded-full for primary action bars/buttons, and avoid bulky nested card stacks.

7. Use cards sparingly.
   A modal/drawer can be a surface. Repeated items can be cards. Do not put every section inside a card.

8. Mobile is first-class.
   Bottom sheets, sticky save bars, short labels, fewer columns, camera/upload first where relevant.

## Visual Language

Use restrained contrast and subtle surfaces:

- Main surface: `bg-background/95`, slight blur, thin border.
- Secondary controls: `bg-secondary/60` or `bg-secondary/70`.
- Active segmented state: `bg-background text-foreground shadow-sm` or inverted `bg-foreground text-background`.
- Borders: `border-border/70`.
- Primary action: dark foreground button, not loud color by default.
- Accent colors only for status, warnings, and meaningful categorisation.

Preferred shape language:

- Dialog/bottom sheet: `rounded-t-3xl md:rounded-3xl`.
- Buttons: `rounded-full`, height `h-10` or `h-11`.
- Guided choice chips: `rounded-2xl`, icon + short label.
- Inputs/selects: default system styling, compact, no oversized decorative wrappers.

## Form Structure Pattern

Use this order for operational capture forms:

1. Header
   - Clear title.
   - One-line operational promise.
   - Close icon only.

2. Mode selector if needed
   - `Full` / `Quick`, `Manual` / `Import`, etc.
   - Keep as a compact segmented control.

3. Primary identity
   - Name/title first.
   - Description immediately after if useful.

4. Fast evidence/capture
   - Receipt, file, image, note, or source data.
   - On mobile, camera/upload should be prominent but not enormous.

5. Required operational fields
   - Date, amount, category, person, supplier, status.

6. Guided allocation/linking
   - Present as a plain-language question.
   - Use outcome-based helper text.

7. Secondary toggles
   - Reimbursable, recoverable, notify client, visible to portal.

8. Sticky action bar
   - Cancel + primary action.
   - Primary action label should say what happens: `Save expense`, `Save for review`, `Create order`.

## Guided Linking Pattern

When a record can connect to many business objects, do not expose raw relational language first.

Use:

```jsx
<section>
  <h3>What is this for?</h3>
  <p>This decides where it appears in reports.</p>
  <ChoiceGrid options={[
    { key: 'none', label: 'General', helper: 'Business expense, not tied to a customer job.' },
    { key: 'client', label: 'Client', helper: 'Useful when it may be recovered from a client.' },
    { key: 'order', label: 'Order', helper: "Adds the cost to one order's profitability." },
    { key: 'purchase_order', label: 'Supplier PO', helper: 'Connects the spend to a buying run or supplier order.' },
  ]} />
</section>
```

Rules:

- Show one selector after the user picks a link type.
- Keep the current selection visible as a small pill.
- Use natural names: `Choose order`, `Choose supplier PO`, `Choose client`.
- If a link affects recovery/profit, say so in helper text.

## Expense Capture Rules

Full expense should require:

- Expense name.
- Date.
- Amount.
- Category.
- Vendor only when spend type is `Supplier Purchase` and vendor mode requires it.

Quick expense should allow:

- Receipt OR amount OR name OR note.
- Missing accounting fields.
- Status `needs_review` when incomplete.

Expense defaults:

- VAT: `No VAT`.
- Full payment method: `Cash` unless context says otherwise.
- Quick payment method: `Unknown` is acceptable.
- Category: `Unsorted` for quick capture, context category for full form.

Expense linking options:

- General: business overhead.
- Client: may be recoverable.
- Order: affects order profitability.
- Supplier PO: ties to supplier purchasing/buying run.
- Project: broader project cost.
- Production: internal job/request cost.

## Microcopy Rules

Use field labels that match how the team speaks:

- `Expense name`, not `Title`.
- `Description`, not `Notes` when it explains the transaction.
- `Vendor / paid to`, not only `Vendor`.
- `Supplier PO`, not `purchase_order_id` or `PO link`.
- `What is this expense for?`, not `Cost allocation` alone.

Helper copy should be short and consequential:

- `Adds the cost to one order's profitability.`
- `Useful when it may be recovered from a client.`
- `Business expense, not tied to a customer job.`
- `Connects the spend to a buying run or supplier order.`

## Mobile Requirements

- Use a bottom sheet feel on small screens.
- Keep the header sticky only if the form scrolls.
- Use a sticky bottom action bar.
- Avoid large hero-style upload boxes unless capture is the whole task.
- Use two-column grids only where labels are short and values fit.
- No explanatory paragraphs inside the main flow except one-line helper text.

## Component Checklist For Agents

Before shipping a new OPPS screen, confirm:

- The first field is the object name or natural user intent.
- Required fields are visually and logically early.
- Any advanced relationship is guided by a question.
- Buttons are compact, clear, and action-specific.
- Mobile can complete the core flow without horizontal crowding.
- Defaults reduce work and do not create false accounting precision.
- Empty/null relationships render gracefully in lists and dashboards.
- The UI does not rely on users understanding database vocabulary.

## Agent Prompt Snippet

Use this when asking another agent to build or refine OPPS UI:

```text
Follow docs/OPPS_PRODUCT_UX_STYLE_GUIDE.md. Build OPPS screens as calm, premium, operational tools: Apple/Tesla minimal, compact, guided, mobile-first. Put the business object first, use plain-language choices for links/allocation, explain business consequences in one-line helper text, avoid bulky cards, and default to safe low-friction values. The user should understand what each field does without knowing database terms.
```
