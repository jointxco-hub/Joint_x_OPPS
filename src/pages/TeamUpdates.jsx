import { useEffect, useState } from "react";
import { dataClient } from "@/api/dataClient";
import WorkReports from "@/components/hub/WorkReports";

export default function TeamUpdates() {
  const [user, setUser] = useState(null);
  useEffect(() => { dataClient.auth.me().then(setUser).catch(() => setUser(null)); }, []);
  if (!user) return <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">Loading your team updates…</div>;
  return <main className="min-h-screen bg-background"><div className="mx-auto max-w-4xl px-4 py-6"><header className="mb-6"><p className="text-xs font-semibold uppercase tracking-wider text-primary">Team rhythm</p><h1 className="mt-1 text-2xl font-bold text-foreground">Daily & weekly updates</h1><p className="mt-1 text-sm text-muted-foreground">Share progress, blockers and the support you need. Your admins can use these to improve the workflow.</p></header><WorkReports user={user} role={null} /></div></main>;
}