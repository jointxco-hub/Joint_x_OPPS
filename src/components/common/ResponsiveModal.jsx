import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

const sizeMap = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export default function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
  footer,
}) {
  const isMobile = useIsMobile();

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
