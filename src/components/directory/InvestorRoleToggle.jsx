import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import { userDisplayName } from "@/lib/teamUsers";

export default function InvestorRoleToggle({ member, onChanged, allowAdminChange = false }) {
  const [saving, setSaving] = useState(false);
  if (member?.role === "admin" && !allowAdminChange) return null;
  const investor = member?.role === "investor";
  const update = async () => {
    setSaving(true);
    try {
      await dataClient.entities.User.update(member.id, { role: investor ? "user" : "investor" });
      await onChanged?.();
      toast.success(investor ? `${userDisplayName(member)} is now a team member` : `${userDisplayName(member)} is now an investor`);
    } catch (error) {
      toast.error(error?.message || "Could not update this role");
    } finally { setSaving(false); }
  };
  return <button type="button" disabled={saving} onClick={update} className="mt-3 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50">{saving ? "Saving…" : investor ? "Make team member" : "Make investor"}</button>;
}