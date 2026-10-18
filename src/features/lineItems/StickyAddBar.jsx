// Shared sticky "Add item" action shell for the Quote/Invoice line-item
// editors. Uses position:sticky (not fixed) scoped to this list's own
// container, so it only floats over earlier line items while the list is
// being scrolled and naturally returns to normal flow once the list ends
// — it can never cover the totals card, Save/Create controls, or a
// portal-rendered dialog, all of which live outside this list's own
// container. Reverts to a plain static row at `sm:` and up, matching the
// pre-existing desktop/tablet layout.
export default function StickyAddBar({ children }) {
  return (
    <div
      className={[
        "sticky bottom-0 z-10 -mx-2.5 flex flex-wrap items-center gap-2",
        "border-t border-border bg-card/95 px-2.5 py-2 backdrop-blur",
        "supports-[backdrop-filter]:bg-card/80",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        "sm:static sm:z-auto sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:pb-0 sm:backdrop-blur-none",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
