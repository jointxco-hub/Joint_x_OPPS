# OPPS Upgrade — v3 Addendum
**Builds on v2. Read v2 first; this adds the seven concerns from the latest message.**

> v2 (`OPPS_v2_Aligned_Spec.md`) is still the implementation backbone. v3 layers in: mobile-first rules, dummy-proof helpers, default admin lock, file viewer fix, calculator simplification, inventory edit + supplier linkage, push/WhatsApp notifications scaffold, and a launch-readiness audit.

---

## 19. Mobile-first as a global rule

### 19.1 The problem

Several surfaces collapse on phones — most painfully `OpsTaskFormDialog` (572-line `OpsCalendar` calls a Radix Dialog with `max-w-2xl max-h-[90vh] overflow-y-auto` that scrolls awkwardly on a 380px viewport, with form fields stacked but no responsive padding/touch sizing).

### 19.2 The rule

Every dialog with more than 4 form fields must render as a **bottom sheet on mobile, dialog on desktop.** The codebase already has the primitives — `src/hooks/use-mobile.jsx` (`useIsMobile`), `src/components/ui/drawer.jsx`, `src/components/ui/sheet.jsx`. Nothing new to install.

### 19.3 Build a `ResponsiveModal` wrapper

Create `src/components/common/ResponsiveModal.jsx`:

```jsx
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

/**
 * Single component for every modal in the app.
 * - Mobile: bottom sheet (drawer), full width, swipe-to-close, content scrolls inside.
 * - Desktop: centered dialog, configurable max width.
 *
 * Replaces every direct usage of <Dialog>/<DialogContent> for forms longer than 4 fields.
 */
export default function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",       // sm | md | lg | xl
  children,
  footer,
}) {
  const isMobile = useIsMobile();

  const sizeMap = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto flex-1">{children}</div>
          {footer && <div className="px-4 pb-6 pt-2 border-t border-border">{footer}</div>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${sizeMap[size]} max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </DialogHeader>
        {children}
        {footer && <div className="pt-4 mt-4 border-t border-border">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
```

### 19.4 Replace `OpsTaskFormDialog`'s direct `<Dialog>` with `<ResponsiveModal>`

Same for every form dialog in the app. Specifically migrate:

```
src/components/ops/OpsTaskFormDialog.jsx           # priority 1 — the one user complained about
src/components/orders/NewOrderDrawer.jsx           # already uses Drawer — leave it
src/components/orders/OrderDrawer.jsx              # already uses Drawer — leave it
src/pages/RolesManagement.jsx                      # inline RoleFormDialog — convert
src/pages/Inventory.jsx                            # inline AddItemModal — convert + extend (see §22)
src/pages/WeeklyCalendar.jsx                       # task and goal dialogs — convert both
src/pages/TeamProfiles.jsx                         # member form — convert
src/pages/RolesManagement.jsx                      # role form — convert
src/pages/CatalogManagement.jsx                    # convert
src/pages/PurchaseOrders.jsx                       # convert
src/pages/Suppliers.jsx                            # convert
src/components/orders/TypeformOrderForm.jsx        # leave — it's already full-page on mobile
```

### 19.5 Touch sizing rules

In every form, use these classes (no exceptions — these are the tap targets):

- Inputs: `h-11` minimum (44px iOS guideline). Existing forms use `h-8`/`h-10` — bump to `h-11` on mobile via `h-11 md:h-10`.
- Buttons: `h-11` mobile, `h-9`/`h-10` desktop.
- Spacing between fields: `space-y-4` on mobile (vs `space-y-3` desktop) — fingers need room.
- Icon buttons: `w-10 h-10` minimum on mobile.

Add a Tailwind plugin shortcut isn't necessary — use `md:` breakpoint inline.

### 19.6 Mobile patterns for non-modal surfaces

- **OpsCalendar 12-week view**: on mobile, scroll horizontally. 12 columns × 7 rows is unreadable on a phone otherwise. Render the grid in an `overflow-x-auto` container with sticky day-of-week column on the left.
- **Tables**: every `grid-cols-N` table must collapse to stacked cards on mobile. Pattern: render `<div class="hidden md:grid grid-cols-N">` for the desktop row, and `<div class="md:hidden">` for a card layout below.
- **Sidebar**: existing `Layout.jsx` already collapses to a top bar on mobile — don't touch it.

### 19.7 Acceptance

- [ ] Open `/OpsCalendar` on a phone (or 380px viewport in DevTools) → tap "+ New Task" → form opens as a bottom sheet, all fields tappable, no horizontal scroll, "Save" button always visible.
- [ ] Same for all dialogs in §19.4.
- [ ] 12-week calendar view scrolls horizontally on mobile with sticky weekday column.
- [ ] No inputs smaller than 44px height on mobile.

---

## 20. Dummy-proof helpers (the "what is this?" pattern)

### 20.1 The problem

A user opens "My Hub", sees "Week 4 of 12", "North Star", "WAM", "QBR", "Lead/Lag KPI", "4D Mix" — and doesn't know what any of it means or where the framework comes from. Same for the Ops Calendar 12WY view. This needs to be explained inline, minimally, without nagging.

### 20.2 Build `<HelperHint>` — a single component for every explanation

Create `src/components/common/HelperHint.jsx`:

```jsx
import { useState, useEffect } from "react";
import { HelpCircle, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A small "?" icon next to any term/feature. Tap or hover → explanation.
 * Once dismissed permanently for a given key, it stays dismissed (localStorage).
 *
 * Usage:
 *   <HelperHint
 *     storageKey="north_star"
 *     title="North Star"
 *     body="The single most important goal for the company over the next 12 weeks. Everyone's work cascades to this."
 *     learnMore="From Brian Moran's '12 Week Year' — we treat 12 weeks as a year and execute against one company goal."
 *   />
 */
export default function HelperHint({
  storageKey,
  title,
  body,
  learnMore,
  size = "sm",       // sm | md
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (storageKey && typeof window !== "undefined") {
      setDismissed(localStorage.getItem(`hint_dismissed:${storageKey}`) === "1");
    }
  }, [storageKey]);

  const dismiss = () => {
    if (storageKey) localStorage.setItem(`hint_dismissed:${storageKey}`, "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center text-muted-foreground hover:text-primary transition-colors"
          aria-label={`What is ${title}?`}
        >
          <HelpCircle className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="max-w-xs p-3 text-xs">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-foreground">{title}</p>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground" title="Don't show this again">
            <X className="w-3 h-3" />
          </button>
        </div>
        <p className="text-muted-foreground mb-1">{body}</p>
        {learnMore && (
          <p className="text-muted-foreground/70 italic text-[11px] mt-2 pt-2 border-t border-border">
            {learnMore}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

### 20.3 Where to place hints (the minimum set)

Each placement is a single line: the term, then `<HelperHint>` next to it. Don't write paragraphs of help text — keep `body` to ~20 words and `learnMore` (the book attribution) to ~25 words.

| Location | Term | Body | Source |
|---|---|---|---|
| `NorthStarBanner.jsx` | "North Star" | "The single most important company goal for this 12-week cycle. Everyone's work points to this." | Brian Moran, *12 Week Year* |
| `CycleProgressBar.jsx` | "Week 4 of 12" | "We treat 12 weeks as a year. This is the current week of the active cycle." | *12 Week Year* |
| `ExecutionScoreCard.jsx` | "Execution Score" | "% of your weekly tactics completed. Aim for 85%+." | *12 Week Year* |
| `MyRoleCard.jsx` | "QBR" | "Queen Bee Role — the single most important repeatable activity for your role. Do this daily." | Mike Michalowicz, *Clockwork* |
| `MyRoleCard.jsx` | "4D Mix" | "Doing / Deciding / Delegating / Designing — what % of your time should go to each as you grow into your role." | *Clockwork* |
| `KpiTile.jsx` (lead) | "Lead KPI" | "An input you control (e.g., posts published). Lead indicators predict results." | Hormozi / 12WY |
| `KpiTile.jsx` (lag) | "Lag KPI" | "A result you measure (e.g., revenue). Lag indicators tell you what already happened." | Hormozi / 12WY |
| `WamPanel.jsx` | "WAM" | "Weekly Accountability Meeting — Friday review: wins, lessons, next-week focus. 15 minutes." | *12 Week Year* |
| `OpsCalendar` toolbar (12WY tab) | "12 Week View" | "Your full cycle on one screen — 12 weeks across, 7 days down. Today is highlighted." | *12 Week Year* |
| `OffersDashboard.jsx` | "Value Equation" | "(Dream outcome × likelihood) ÷ (delay × effort) = how compelling an offer is." | Hormozi, *$100M Offers* |
| `MoneyModel.jsx` | "Payback period" | "Days until an order's gross profit covers its acquisition cost. Aim under 30." | Hormozi, *$100M Money Models* |
| `Operations` page | "Founder Dependency" | "% of orders the founder gets pulled into. Lower is better — a sellable business runs without you." | John Warrillow, *Built to Sell* |

### 20.4 Empty-state coaching

When a panel has no data, show actionable empty state — not "No data". For example, `MyTagsInbox` empty state:

> 🎯 **All clear.** No orders waiting on your role right now. New tags will appear here when an order moves to a stage that needs you.

### 20.5 First-run onboarding popover (one-time)

When a user opens `/UserDashboard` for the first time (no `localStorage["onboarded:hub"]`), show a 3-step popover tour:
1. "This is your North Star — the company's single goal this cycle."
2. "These are your weekly tactics. Aim for 85%+ completion."
3. "When orders need you, they'll appear in My Tags."

Use a tiny library — actually, don't add one. Hand-roll it with state + a transparent overlay + 3 positioned popovers. ~80 lines of code. Library for 80 lines isn't worth it.

### 20.6 Acceptance

- [ ] Every term in §20.3 has a `<HelperHint>` that opens on tap.
- [ ] Tapping the X in a hint hides it permanently for that user (localStorage).
- [ ] First load of `/UserDashboard` shows a 3-step tour; subsequent loads don't.
- [ ] Empty states have actionable text, not "No data".

---

## 21. Default admin = jointx.co@gmail.com

### 21.1 The rule

Setting the company 12WY North Star, editing roles, scoring offers, viewing the money model, accessing `/RolesManagement`, `/Operations`, `/Executive`, `/OffersDashboard`, `/MoneyModel` — all admin-gated. By default, the admin is `jointx.co@gmail.com`. Always.

### 21.2 Implementation

The current `Layout.jsx` already filters nav items by `user?.role === 'admin'`. That works for the sidebar. We need **route-level enforcement** too, so a non-admin can't paste a URL.

#### 21.2.1 Database

Update the `users` table seed (or run as a one-time SQL):

```sql
update public.users set role = 'admin' where user_email = 'jointx.co@gmail.com';

-- If the user record doesn't exist yet (first sign-in hasn't happened), insert it
-- as a placeholder so the role is locked from day 0:
insert into public.users (user_email, full_name, role, is_active)
values ('jointx.co@gmail.com', 'Founder', 'admin', true)
on conflict (user_email) do update set role = 'admin';
```

#### 21.2.2 Constants file

Create `src/lib/admin.js`:

```js
/**
 * The hardcoded fallback admin. If the database is empty, somebody locked
 * themselves out of admin, or roles haven't seeded yet — this email is ALWAYS
 * treated as admin by the frontend.
 */
export const DEFAULT_ADMIN_EMAILS = ['jointx.co@gmail.com'];

export function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (DEFAULT_ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return true;
  return false;
}
```

#### 21.2.3 Route guard

Create `src/components/common/AdminOnly.jsx`:

```jsx
import { useEffect, useState } from "react";
import { dataClient } from "@/api/dataClient";
import { isAdmin } from "@/lib/admin";
import { Lock } from "lucide-react";

export default function AdminOnly({ children, fallback }) {
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    dataClient.auth.me().then(setUser).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  if (!isAdmin(user)) {
    return fallback ?? (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
            <Lock className="w-5 h-5 text-muted-foreground" />
          </div>
          <h2 className="font-semibold text-foreground mb-1">Admin only</h2>
          <p className="text-sm text-muted-foreground">
            This page is restricted to admins. Ask the founder for access.
          </p>
        </div>
      </div>
    );
  }
  return children;
}
```

Wrap admin pages — change their default exports:

```jsx
// src/pages/RolesManagement.jsx
function RolesManagementInner() { /* existing component body */ }
export default function RolesManagement() {
  return <AdminOnly><RolesManagementInner /></AdminOnly>;
}
```

Apply to: `RolesManagement`, `Executive`, `Operations`, `OffersDashboard`, `MoneyModel`, `OnboardingManagement`, `CatalogManagement`, `Suppliers`, `PurchaseOrders`.

For inline UI (e.g., the "Edit North Star" button on the hub), gate it with `isAdmin(user)` directly:

```jsx
{isAdmin(user) && <Button onClick={openEditNorthStar}>Edit</Button>}
```

#### 21.2.4 Layout sidebar

Update `Layout.jsx` filter — replace `user?.role === 'admin'` checks with the helper:

```jsx
import { isAdmin } from "@/lib/admin";
const visibleMoreNav = moreNav.filter(item => !item.roles || isAdmin(user));
```

### 21.3 Acceptance

- [ ] Sign in as `jointx.co@gmail.com` → see all admin nav items.
- [ ] Sign in as a non-admin → admin pages show "Admin only" lock screen.
- [ ] Pasting `/RolesManagement` URL as non-admin shows the lock, not the form.
- [ ] North Star edit button only visible to admins.

---

## 22. File Manager — fix viewer + edit/delete/archive

### 22.1 The problem

`src/components/files/FileThumbnail.jsx` line 21:
```js
window.open(fileUrl, '_blank');     // ← opens in a new browser tab
```
And line 29 uses `target='_blank'` for downloads. There's a perfectly good `FileLightbox.jsx` component that should handle in-app viewing — it just isn't wired here.

### 22.2 Fix the thumbnail

Change `FileThumbnail.jsx` to call a passed-in `onOpen` prop instead of `window.open`:

```jsx
export default function FileThumbnail({
  fileUrl, fileType, title, className = "", onOpen, onDownload
}) {
  // ...existing format detection...

  const handleOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onOpen) onOpen({ fileUrl, fileType, title });
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    if (onDownload) onDownload({ fileUrl, fileType, title });
    else {
      // safe default: trigger a download attribute
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = title || 'file';
      a.click();
    }
  };

  // rest same
}
```

In `FileManager.jsx`, pass `onOpen={(f) => setLightboxFile(f)}` to every `<FileThumbnail>`.

### 22.3 Upgrade `FileLightbox` to handle every type

The existing lightbox shows images and links. Extend it:

- **Images** (jpg/png/gif/webp/svg): `<img src>` — already works.
- **PDFs**: `<iframe src={fileUrl} class="w-full h-full">` — Chrome/Safari render natively.
- **Videos** (mp4/webm/mov): `<video controls src>` — native player.
- **Office docs** (docx/xlsx/pptx): use Microsoft Office Online viewer fallback:
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}` in an iframe. Works for any publicly accessible URL (Supabase public bucket).
- **Text/markdown** (txt/md): fetch + render with `react-markdown` (already installed).
- **Archives** (zip/rar): show "preview not available" + download button.
- **Anything else**: download button.

The lightbox should be a `ResponsiveModal` (§19.3) with `size="xl"`, full-screen on mobile.

### 22.4 Add edit + archive to files

`ClientAsset` and `Folder` entities both need rename, move, delete, archive. Add to `dataClient` ENTITY_CONFIG (it's already in v2's §2.4 list, but specifically for `ClientAsset` make sure these payload keys go through:

```js
ClientAsset: {
  table: 'client_assets',
  // ...existing serialize/normalize
  serialize(payload) {
    return compactObject({
      title: payload.title,
      file_url: payload.file_url,
      file_type: payload.file_type,
      file_size: payload.file_size,
      folder_id: payload.folder_id,
      client_id: payload.client_id,
      order_id: payload.order_id,
      project_id: payload.project_id,
      uploaded_by: payload.uploaded_by,
      approval_status: payload.approval_status,
      tags: payload.tags,
      notes: payload.notes,
      is_archived: payload.is_archived,
      archived_at: payload.archived_at,
    });
  },
},
```

Schema (add to phase2_entities migration if not present):

```sql
create table if not exists public.folders (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  color        text default 'slate',
  parent_id    uuid references public.folders(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  project_id   uuid references public.projects(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  created_by   text,
  is_archived  boolean default false,
  archived_at  timestamptz,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);

create table if not exists public.client_assets (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  file_url        text not null,
  file_type       text,
  file_size       bigint,
  folder_id       uuid references public.folders(id) on delete set null,
  client_id       uuid references public.clients(id) on delete set null,
  order_id        uuid references public.orders(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  uploaded_by     text,
  approval_status text default 'pending'
                  check (approval_status in ('pending','approved','needs_revision','rejected')),
  tags            text[] default '{}',
  notes           text,
  is_archived     boolean default false,
  archived_at     timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
create index if not exists idx_assets_folder on public.client_assets(folder_id);
create index if not exists idx_assets_client on public.client_assets(client_id);
create index if not exists idx_assets_order  on public.client_assets(order_id);
```

### 22.5 File actions menu

Each `FileThumbnail` gets a 3-dot menu (`<DropdownMenu>` already used in `FileManager.jsx`) with: View, Download, Rename, Move to folder…, Link to client/order/project, Archive, Delete. Each action wires to a `dataClient.entities.ClientAsset.update` or `.delete` call.

### 22.6 Linking files across the app

Files should appear:
- In `OrderDrawer.jsx` — a "Files" tab that filters `client_assets` by `order_id`.
- In `Projects.jsx` / `ProjectHub.jsx` — a "Files" tab filtered by `project_id`.
- In `Clients.jsx` — a "Files" tab filtered by `client_id`.

Each tab renders the same `<FileGrid>` component, just with a pre-applied filter. Building the file picker as a reusable component avoids duplicating the lightbox/menu logic.

### 22.7 Acceptance

- [ ] Click a file in `/FileManager` → opens in the lightbox modal (in-app), not a new tab.
- [ ] PDFs and videos play inline.
- [ ] DOCX/XLSX/PPTX render via Office Online iframe.
- [ ] Right-click / 3-dot menu shows: View, Download, Rename, Move, Archive, Delete.
- [ ] Opening an order's drawer shows a Files tab listing only that order's files.
- [ ] Folders can be edited (color, name, parent) and archived.

---

## 23. Calculator — remove VAT, simplify

### 23.1 The change

`src/pages/Calculator.jsx` currently has a `tax` state defaulted to 15. Remove it. The new formula is just **Cost + Margin = Price**.

### 23.2 New formula (line ~20–27)

Replace:
```js
const taxAmount = priceBeforeTax * (tax / 100);
const finalPrice = priceBeforeTax + taxAmount;
```
With:
```js
const finalPrice = priceBeforeTax;
```

Remove the tax slider/input. Remove the `tax` and `setTax` state. Remove the line "+ Tax = Price" subtitle — change to:

```jsx
<p className="text-muted-foreground text-sm">Cost + Margin = Price</p>
```

### 23.3 Add useful additions

Since we're simplifying, add three things that matter more for a clothing biz:

- **Bulk pricing tiers**: "for 10 units / 50 units / 100 units" — show side-by-side. Encourages volume orders.
- **Save preset**: persist named presets to `localStorage` (e.g., "X1 Basic", "Hoodie deluxe").
- **Profit per unit**: explicit display, not just total revenue.

### 23.4 Acceptance

- [ ] No VAT/tax input visible.
- [ ] Final price = costPerUnit × (1 + margin/100).
- [ ] Three quantity columns visible (10 / 50 / 100) showing per-unit price + total.

---

## 24. Inventory — edit form, supplier link, variant identifier, X LAB sync

### 24.1 The four problems

1. **Can't edit beyond `current_stock`**: `Inventory.jsx`'s inline edit only handles `current_stock`. To edit name/SKU/reorder point, you have to delete and re-create.
2. **No supplier on items**: `InventoryItem` schema has no `supplier_id`. You can't tell whether the JET base layer is from JHG or Supplier B.
3. **No variant ID**: same product, different supplier — needs a stable identifier the team can use on the floor.
4. **No auto-decrement when X LAB sells**: when a customer pays through X LAB, the matching inventory items should decrement.

### 24.2 Schema additions

Add to phase2 migration:

```sql
alter table public.inventory add column if not exists supplier_id uuid
  references public.suppliers(id) on delete set null;
alter table public.inventory add column if not exists supplier_sku text;       -- supplier's own code
alter table public.inventory add column if not exists variant_label text;      -- e.g., "JHG-JET-XL-BLK"
alter table public.inventory add column if not exists parent_item_id uuid
  references public.inventory(id) on delete set null;                          -- for JET-from-JHG vs JET-from-Supplier-B
alter table public.inventory add column if not exists low_stock_alert_email text[];
alter table public.inventory add column if not exists product_skus text[];     -- X1/XLAB SKUs that consume this stock
alter table public.inventory add column if not exists units_per_product int default 1;

create index if not exists idx_inventory_supplier on public.inventory(supplier_id);
create index if not exists idx_inventory_variant  on public.inventory(variant_label);
```

### 24.3 dataClient.js — extend `InventoryItem.serialize`

```js
serialize(payload) {
  return compactObject({
    name: payload.name,
    sku: payload.sku,
    category: payload.category ?? 'other',
    current_stock: numberOrUndefined(payload.current_stock ?? payload.stock),
    unit: payload.unit,
    reorder_point: numberOrUndefined(payload.reorder_point),
    reorder_quantity: numberOrUndefined(payload.reorder_quantity),
    last_reorder_date: payload.last_reorder_date,
    sizes_available: payload.sizes_available,
    colors_available: payload.colors_available,
    cost_price: numberOrUndefined(payload.cost_price),
    selling_price: numberOrUndefined(payload.selling_price),
    location: payload.location,
    is_archived: payload.is_archived,
    archived_at: payload.archived_at,
    // NEW:
    supplier_id: payload.supplier_id,
    supplier_sku: payload.supplier_sku,
    variant_label: payload.variant_label,
    parent_item_id: payload.parent_item_id,
    low_stock_alert_email: payload.low_stock_alert_email,
    product_skus: payload.product_skus,
    units_per_product: numberOrUndefined(payload.units_per_product),
  });
},
```

### 24.4 Edit modal

Convert `Inventory.jsx`'s inline `AddItemModal` into `InventoryItemModal` (in `src/components/inventory/InventoryItemModal.jsx`) using `<ResponsiveModal>`. It accepts an optional `item` prop — when set, the form pre-fills and on submit calls `update`; when null, calls `create`.

Add a per-row **Edit** button to `Inventory.jsx`:

```jsx
<button onClick={() => setEditingItem(item)} className="text-muted-foreground hover:text-primary">
  <Edit2 className="w-3.5 h-3.5" />
</button>
```

Form fields (with helper hints):
- Name *
- SKU
- Variant label (with hint: "A short code that distinguishes this version from others — e.g., 'JHG-JET-XL-BLK' for the JHG supplier's JET base in size XL black.")
- Supplier (dropdown of `Supplier`s)
- Supplier's SKU
- Parent item (optional — for variants of the same generic product)
- Category
- Current stock / Reorder at / Reorder quantity / Unit
- Cost price / Selling price
- Sizes available (multi-select), Colors available (multi-select)
- Location
- Linked product SKUs (multi-text — which X1/X LAB product SKUs consume this stock)
- Units per product (default 1 — e.g., a hoodie pack might consume 1 hoodie + 1 zip + 1 thread)
- Low-stock alert recipients (emails — comma-separated)

### 24.5 Auto-decrement when X LAB sells

This is a cross-app concern. Two options, in order of robustness:

**Option A — Postgres trigger (preferred).** When `payments.status` becomes `completed` AND the linked order has products, decrement the matching inventory rows.

```sql
create or replace function public.decrement_inventory_on_payment()
returns trigger language plpgsql as $$
declare
  ord record;
  prod jsonb;
  inv record;
begin
  -- Only act when transitioning to 'completed'
  if new.status = 'completed' and (old is null or old.status is distinct from 'completed') then
    select * into ord from public.orders where id = new.order_id;
    if ord.id is null then return new; end if;

    for prod in select * from jsonb_array_elements(ord.products) loop
      for inv in
        select * from public.inventory
        where (prod->>'sku') = any(coalesce(product_skus, '{}'))
          and is_archived = false
      loop
        update public.inventory
          set current_stock = current_stock
            - ((prod->>'quantity')::int * coalesce(inv.units_per_product, 1))
          where id = inv.id;

        -- If now below reorder point, fire an alert event
        if (inv.current_stock - ((prod->>'quantity')::int * coalesce(inv.units_per_product, 1)))
            <= coalesce(inv.reorder_point, 0) then
          insert into public.notification_queue (event_type, payload)
          values ('low_stock', jsonb_build_object(
            'inventory_id', inv.id,
            'name', inv.name,
            'remaining', inv.current_stock - ((prod->>'quantity')::int * coalesce(inv.units_per_product, 1)),
            'reorder_point', inv.reorder_point,
            'recipients', inv.low_stock_alert_email
          ));
        end if;
      end loop;
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists trg_decrement_inventory on public.payments;
create trigger trg_decrement_inventory
  after insert or update on public.payments
  for each row execute function public.decrement_inventory_on_payment();
```

**Option B — Edge Function.** The X LAB `payfast-notify` function decrements inventory directly after marking the order paid. Cleaner separation of concerns but requires X LAB code changes.

Use Option A for now because it auto-applies regardless of which app updated `payments`.

### 24.6 Acceptance

- [ ] Inventory page has Edit button per row → opens responsive modal with all fields.
- [ ] Creating an item with a supplier shows the supplier name in the table.
- [ ] Two items with the same `parent_item_id` (e.g., JET from JHG vs JET from B) display together with their `variant_label` differentiating them.
- [ ] Marking a payment as completed via X LAB → matching inventory `current_stock` drops by the order quantity.
- [ ] When stock crosses the reorder point, a row appears in `notification_queue` with `event_type='low_stock'`.

---

## 25. Notifications — push + WhatsApp

### 25.1 Architecture

Don't build a full notification system in the frontend. Build a **queue table + per-channel dispatcher** so any event can fan out to multiple channels. This unlocks email, WhatsApp, push, in-app — all triggered the same way.

### 25.2 Schema

```sql
create table if not exists public.notification_queue (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,        -- 'order_tag','low_stock','order_paid','wam_due','qbr_missed', etc.
  payload       jsonb not null,
  channels      text[] default '{push,whatsapp,email,in_app}',
  status        text default 'pending'
                check (status in ('pending','processing','sent','failed','skipped')),
  attempts      int default 0,
  last_error    text,
  scheduled_for timestamptz default now(),
  sent_at       timestamptz,
  created_at    timestamptz default now() not null
);

create index if not exists idx_notification_pending on public.notification_queue(status, scheduled_for);

-- Per-user channel preferences
create table if not exists public.notification_preferences (
  user_email     text primary key,
  push_enabled   boolean default true,
  whatsapp_phone text,                          -- E.164 format, e.g. +27821234567
  whatsapp_enabled boolean default false,
  email_enabled  boolean default true,
  quiet_hours_start time,                       -- e.g. 21:00
  quiet_hours_end   time,                       -- e.g. 07:00
  updated_at     timestamptz default now() not null
);
```

### 25.3 Web push

Web push uses browser-native APIs + a service worker. Two new files:

- `public/sw.js` — service worker that handles `push` events and shows notifications.
- `src/lib/push.js` — front-end helpers: `requestPermission()`, `subscribeToPush()`, `unsubscribeFromPush()`. Stores the subscription endpoint in a new table:

```sql
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz default now() not null,
  unique (endpoint)
);
```

Add a settings panel: `src/pages/Settings.jsx` (or under existing `RolesManagement` as a tab). Toggles:
- Enable browser notifications
- Enable WhatsApp notifications + phone number input
- Quiet hours
- Per-event-type toggles (e.g., only get notified for order tags assigned to me, not all stage changes)

### 25.4 WhatsApp

Use the **WhatsApp Cloud API** (Meta — free tier covers small biz volume) or **Twilio** if Meta access is hard. The dispatcher is a Supabase Edge Function:

```
supabase/functions/notification-dispatch/index.ts
```

It runs on a cron (`pg_cron` extension or external scheduler) every minute:

```ts
// Pseudocode — actual implementation will use Deno's fetch + your provider
import { createClient } from 'jsr:@supabase/supabase-js';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async () => {
  const { data: pending } = await supabase
    .from('notification_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at')
    .limit(50);

  for (const job of pending ?? []) {
    await supabase.from('notification_queue').update({ status: 'processing', attempts: job.attempts + 1 }).eq('id', job.id);
    try {
      const recipients = await resolveRecipients(job);  // looks up notification_preferences
      const message = renderTemplate(job.event_type, job.payload);

      const sends = [];
      if (job.channels.includes('push')) sends.push(sendPush(recipients, message));
      if (job.channels.includes('whatsapp')) sends.push(sendWhatsApp(recipients, message));
      if (job.channels.includes('email')) sends.push(sendEmail(recipients, message));

      await Promise.allSettled(sends);
      await supabase.from('notification_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', job.id);
    } catch (e) {
      await supabase.from('notification_queue').update({ status: 'failed', last_error: e.message }).eq('id', job.id);
    }
  }

  return new Response('ok');
});
```

Required env vars (in Supabase project settings):
- `WHATSAPP_API_TOKEN` (Meta Cloud API access token)
- `WHATSAPP_PHONE_NUMBER_ID` (your business phone number ID)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (for web push — generate via `npx web-push generate-vapid-keys`)
- `RESEND_API_KEY` or similar for email

### 25.5 Trigger events from existing tables

Hook the queue from existing flows:

```sql
-- When an order_tag is created with action='escalate' or 'assign', queue a notification
create or replace function public.notify_on_order_tag()
returns trigger language plpgsql as $$
begin
  if new.action in ('escalate','assign','tag') then
    insert into public.notification_queue (event_type, payload, channels)
    values ('order_tag', jsonb_build_object(
      'order_id', new.order_id,
      'role_key', new.role_key,
      'action', new.action,
      'reason', new.reason,
      'context', new.context
    ),
    case when new.action = 'escalate' then array['push','whatsapp','in_app']
         else array['push','in_app'] end);
  end if;
  return new;
end; $$;

drop trigger if exists trg_notify_order_tag on public.order_tags;
create trigger trg_notify_order_tag after insert on public.order_tags
  for each row execute function public.notify_on_order_tag();
```

Repeat for: `order_exceptions` (always escalate channels), `weekly_scores` not submitted by Sunday (cron job), `qbr_log` missed (daily cron).

### 25.6 Acceptance

- [ ] Browser permission prompt appears the first time the user visits with notifications enabled in their settings.
- [ ] Creating an `order_tag` with `action='escalate'` queues a notification within seconds.
- [ ] Receiving a push on desktop/mobile shows the order title and tap-to-open.
- [ ] WhatsApp messages arrive on the configured number for escalations.
- [ ] Quiet hours suppress non-critical notifications; critical (escalate) override.

---

## 26. LAUNCH-READINESS AUDIT (OPPS only — X1 + X LAB pending upload)

### 26.1 What's ready

✅ Auth, sign-in flow (`AuthContext`, `SignIn.jsx`)
✅ Sidebar navigation, mobile top bar
✅ Order CRUD with status flow (5-stage)
✅ Task management (`Task` + `OpsTask`)
✅ Client/Project CRUD
✅ Supplier + Purchase Order pages
✅ Existing Inventory list view
✅ shadcn/ui design system, Tailwind tokens
✅ React Query + Supabase client
✅ Existing 12-week scaffold UI (just doesn't persist)

### 26.2 Blockers — must ship before launch

🔴 **Phase 0 of v2** — entities not persisted. **CRITICAL.** Without this, the 12WY/roles UI loses data on refresh. Single biggest risk.
🔴 **No payment confirmation → order update** — v2 §1 mentions PayFast notify, but this OPPS app doesn't have a webhook handler. The flow is: PayFast notify hits X LAB Edge Function → updates `orders.status` AND `orders.pipeline_stage` → trigger fires here. Verify the X LAB project actually does this when the user uploads it.
🔴 **No Supabase RLS** — every table is wide-open. Acceptable for internal staff app on a private domain, **not acceptable** if X1 client portal lives on the same Supabase project. Audit this when X1 zip arrives.
🔴 **Default admin lock** — §21 of this spec.
🔴 **File viewer in-app** — §22 of this spec.

### 26.3 Should-fix before launch

🟡 Mobile responsiveness on form dialogs — §19
🟡 Helper hints for unfamiliar terms — §20
🟡 Edit + supplier on inventory — §24
🟡 Notifications (push/WhatsApp) — §25 — can ship without these but customers will fall through cracks
🟡 Calculator simplification — §23

### 26.4 Nice-to-have post-launch

🟢 Drag-to-reschedule in calendar
🟢 Tactic templates / "duplicate last week"
🟢 Goal cascade visualization (Sankey)
🟢 4D mix actual-vs-target charts populated from real `time_allocations` data
🟢 Founder Dependency Score historical trend chart
🟢 Bulk operations (e.g., archive 5 orders at once)

### 26.5 Cross-app concerns (will check when X1 + X LAB upload)

When the X1 and X LAB zips arrive, audit:
- Are all three apps pointing to the **same Supabase project** (URL + anon key)?
- Does X LAB's `payfast-notify` Edge Function exist and update both `orders.status` AND `orders.pipeline_stage`?
- Does X1 write directly to the `orders` table, or call an endpoint? If direct: RLS blast radius. If via API: where is the API hosted?
- Is the same `users` table shared across all three apps for SSO?
- Auth: same Supabase Auth across all three?
- Cors / domain allow-lists?
- A `secrets` table or env var sharing strategy?

### 26.6 Aletha cleanup

User confirmed Alethea is now a separate app, will integrate later same as X1/X LAB. Decision: **leave the Alethea code in place** for now. It's read-only without Phase 0 (uses `dataClient.entities.AletheaProject` which falls through to local fallback), so it won't actively cause problems. Hide its sidebar entries until reintegration:

In `Layout.jsx`, the `Alethea*` pages aren't currently in `primaryNav` or `moreNav` — confirmed they're orphaned. They're still routed (so direct URLs work) but invisible. Leave it as is.

When ready to reintegrate (Phase 5 in the future), the entities `AletheaProject`, `AletheaPhase`, `AletheaStep`, `AletheaTask` will need their `ENTITY_CONFIG` mappings — they're already in v2's §2.4 list of entities to add.

### 26.7 Launch checklist (run in order)

1. ☐ Run v2 Phase 0 migration + seed + dataClient wiring. Verify §2.5.
2. ☐ Apply v3 §21 (default admin = jointx.co@gmail.com).
3. ☐ Apply v3 §22 (file viewer in-app).
4. ☐ Apply v3 §19 (mobile responsiveness — at minimum the OpsTaskFormDialog).
5. ☐ Apply v3 §20 (helper hints on key terms).
6. ☐ Apply v3 §23 (calculator no VAT).
7. ☐ Apply v3 §24 (inventory edit + supplier).
8. ☐ Apply v2 Phase 1–4 (My Hub, OpsCalendar, Order Pipeline, Book Dashboards).
9. ☐ Apply v3 §25 (notifications) — can defer to v1.1.
10. ☐ Smoke test on real iPhone + Android + desktop.
11. ☐ Upload X1 + X LAB zips for cross-app audit.
12. ☐ Enable RLS based on cross-app audit findings.
13. ☐ Configure custom domain (`opps.jointx.co` or similar).
14. ☐ Set up Supabase backups (daily auto-backup).
15. ☐ Smoke test full flow: customer order on X1 → pay on X LAB → see in OPPS → tag fires → role gets notification.

### 26.8 Estimated effort (for a single competent developer + Claude Code)

- v2 Phase 0: **0.5 day** (migration + seed + 20 entity mappings)
- v2 Phase 1 (My Hub upgrade): **1 day**
- v2 Phase 2 (OpsCalendar rebuild): **1.5 days**
- v2 Phase 3 (Pipeline + tagging): **1 day**
- v2 Phase 4 (Book dashboards): **0.5 day**
- v3 §19 (mobile): **0.5 day**
- v3 §20 (hints): **0.25 day**
- v3 §21 (admin): **0.25 day**
- v3 §22 (file viewer): **0.5 day**
- v3 §23 (calculator): **0.1 day**
- v3 §24 (inventory + supplier + auto-decrement): **1 day**
- v3 §25 (notifications): **2 days** (most uncertain — depends on WhatsApp API approval timing)

**Total: ~9 working days** for OPPS. WhatsApp API approval can run in parallel.

---

## 27. Final Claude Code prompt for v3

> Read both `OPPS_v2_Aligned_Spec.md` and `OPPS_v3_Addendum.md` end to end. Implement in this order:
>
> 1. v2 Phase 0 (entity persistence — non-negotiable first step)
> 2. v3 §21 (admin lock)
> 3. v3 §19 (ResponsiveModal + migrate `OpsTaskFormDialog` first as proof)
> 4. v2 Phase 1 (My Hub upgrade) — interleave v3 §20 hints as you go
> 5. v2 Phase 2 (OpsCalendar rebuild) — interleave v3 §20 hints
> 6. v3 §22 (file viewer in-app)
> 7. v2 Phase 3 (pipeline + tagging)
> 8. v2 Phase 4 (book dashboards) — interleave v3 §20 hints
> 9. v3 §23 (calculator)
> 10. v3 §24 (inventory edit + supplier)
> 11. v3 §25 (notifications scaffold — push + WhatsApp dispatcher)
>
> After each step, run `npm run build` and walk through that section's acceptance checklist before proceeding. Do not invent new entity names, routes, or pages outside what's specified. Do not reintroduce Base44. Do not modify `tailwind.config.js`, `components.json`, or anything in `src/components/ui/`.
>
> When testing mobile responsiveness, use Chrome DevTools at 380×844 (iPhone 12 Mini) as the strict minimum.

---

**End of v3 addendum.**
