import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const switchStyles = `
.opps-switch {
  position: relative;
  display: inline-flex;
  width: 48px;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  padding: 2px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 999px;
  background: hsl(var(--secondary) / 0.72);
  box-shadow: inset 0 1px 2px hsl(var(--foreground) / 0.08);
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color 260ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 260ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.opps-switch[data-state="checked"] {
  border-color: hsl(var(--foreground));
  background: hsl(var(--foreground));
  box-shadow: inset 0 0 0 1px hsl(var(--background) / 0.08);
}

.opps-switch:hover:not(:disabled) {
  box-shadow:
    inset 0 1px 2px hsl(var(--foreground) / 0.08),
    0 0 0 4px hsl(var(--secondary) / 0.45);
}

.opps-switch:active:not(:disabled) {
  transform: scale(0.97);
}

.opps-switch:focus-visible {
  box-shadow:
    0 0 0 2px hsl(var(--background)),
    0 0 0 4px hsl(var(--ring) / 0.38);
}

.opps-switch:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.opps-switch-thumb {
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: hsl(var(--background));
  box-shadow:
    0 1px 2px hsl(var(--foreground) / 0.18),
    0 4px 10px hsl(var(--foreground) / 0.10);
  pointer-events: none;
  transform: translate3d(0, 0, 0) scale(1);
  will-change: transform;
  transition:
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.opps-switch[data-state="checked"] .opps-switch-thumb {
  transform: translate3d(22px, 0, 0) scale(0.96);
  box-shadow: 0 1px 2px hsl(var(--foreground) / 0.18);
}

.opps-switch:active:not(:disabled) .opps-switch-thumb {
  transform: translate3d(0, 0, 0) scale(0.9);
}

.opps-switch[data-state="checked"]:active:not(:disabled) .opps-switch-thumb {
  transform: translate3d(22px, 0, 0) scale(0.9);
}

@media (prefers-reduced-motion: reduce) {
  .opps-switch,
  .opps-switch-thumb {
    transition-duration: 1ms;
  }
}
`

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <>
    <style>{switchStyles}</style>
    <SwitchPrimitives.Root
      className={cn("opps-switch", className)}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb className="opps-switch-thumb" />
    </SwitchPrimitives.Root>
  </>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
