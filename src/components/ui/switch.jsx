import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border/70 bg-secondary/70 p-0.5 shadow-inner outline-none transition-[background-color,border-color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:shadow-none data-[state=unchecked]:hover:bg-secondary",
      className
    )}
    {...props}
    ref={ref}>
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm ring-0 will-change-transform transition-[transform,box-shadow] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] data-[state=checked]:translate-x-5 data-[state=checked]:shadow-none data-[state=unchecked]:translate-x-0"
      )} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }

