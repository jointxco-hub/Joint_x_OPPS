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
