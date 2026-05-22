import React from "react";

export default function AppLoader({ label = "Loading OPS" }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="ops-loader-mark" aria-hidden="true">
          <span className="ops-loader-dot ops-loader-dot-teal" />
          <span className="ops-loader-dot ops-loader-dot-rust" />
          <span className="ops-loader-dot ops-loader-dot-lavender" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">Joint X</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}
