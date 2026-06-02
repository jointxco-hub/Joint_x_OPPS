import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PortalTab({ order, onUpdate, balance = 0 }) {
  const [newItem, setNewItem] = useState("");

  const portalMessage = order.portal_message || "";
  const showBalance = !!order.portal_show_balance;
  const showFiles = !!order.portal_show_files;
  const attentionItems = Array.isArray(order.portal_attention_items) ? order.portal_attention_items : [];

  const toggle = (field) => onUpdate(order.id, { [field]: !order[field] });

  const addAttention = () => {
    const item = newItem.trim();
    if (!item) return;
    onUpdate(order.id, { portal_attention_items: [...attentionItems, item] });
    setNewItem("");
  };

  const removeAttention = (idx) => {
    onUpdate(order.id, { portal_attention_items: attentionItems.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
        <p className="text-xs font-semibold text-blue-800 mb-0.5">Client Portal Settings</p>
        <p className="text-xs text-blue-700">
          Choose what your client sees when they track this order. Share the tracking link from the Tracking tab.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
          Message to Client
        </label>
        <textarea
          value={portalMessage}
          onChange={(e) => onUpdate(order.id, { portal_message: e.target.value })}
          placeholder="e.g. Hi! Your order is in production. Outstanding balance of R500 due on collection."
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none h-24 outline-none focus:ring-2 focus:ring-primary/20"
        />
        <p className="text-xs text-muted-foreground">Shown at the top of the client tracker when set.</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Show on Tracker</label>
        <div className="space-y-2">
          <label className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl cursor-pointer hover:bg-secondary/50 transition-all">
            <div>
              <p className="text-sm font-medium text-foreground">Outstanding Balance</p>
              <p className="text-xs text-muted-foreground">
                Shows R{Math.abs(balance).toLocaleString()} {balance > 0 ? "owed" : "â€” fully paid"}
              </p>
            </div>
            <div
              onClick={() => toggle("portal_show_balance")}
              className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${showBalance ? "bg-primary" : "bg-border"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${showBalance ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </label>
          <label className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl cursor-pointer hover:bg-secondary/50 transition-all">
            <div>
              <p className="text-sm font-medium text-foreground">Uploaded Files</p>
              <p className="text-xs text-muted-foreground">Only files ticked in the Files tab are shown</p>
            </div>
            <div
              onClick={() => toggle("portal_show_files")}
              className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${showFiles ? "bg-primary" : "bg-border"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${showFiles ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
          Attention Items
        </label>
        <p className="text-xs text-muted-foreground -mt-1">Things the client needs to action or be aware of.</p>
        <div className="space-y-1.5">
          {attentionItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-xl">
              <span className="text-xs font-medium text-amber-900 flex-1">âš  {item}</span>
              <button onClick={() => removeAttention(i)} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder='e.g. "Approve artwork by Friday" or "Balance R1 200 due"'
            className="h-9 rounded-xl text-sm flex-1"
            onKeyDown={(e) => e.key === "Enter" && addAttention()}
          />
          <Button size="sm" variant="outline" className="h-9 rounded-xl px-3 text-xs" onClick={addAttention} disabled={!newItem.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
