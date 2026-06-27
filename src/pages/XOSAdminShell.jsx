import { useEffect, useState } from "react";
import { BarChart3, FileText, FolderOpen, Package, Settings, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import AppLoader from "@/components/common/AppLoader";

const MODULES = [
  { label: "Orders", icon: Package },
  { label: "Requests", icon: FileText },
  { label: "Files", icon: FolderOpen },
  { label: "Reports", icon: BarChart3 },
  { label: "Store Settings", icon: Settings },
];

const EMPTY_GATE = {
  loading: true,
  allowed: false,
  reason: "",
  tenant_slug: "",
  tenant_name: "",
  hostname: "",
};

function BoundaryMarker() {
  return (
    <div className="fixed right-3 top-3 z-50 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 shadow-sm">
      XOS Boundary Active
    </div>
  );
}

function GateState({ title, message, action }) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <BoundaryMarker />
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12">
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-white">
          <ShieldCheck className="h-5 w-5 text-zinc-700" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">XOS Admin</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">{message}</p>
        {action}
      </div>
    </main>
  );
}

export default function XOSAdminShell() {
  const { isLoadingAuth, isAuthenticated, user, checkAppState } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signingInWithEmail, setSigningInWithEmail] = useState(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false);
  const [gate, setGate] = useState(EMPTY_GATE);

  useEffect(() => {
    console.info("XOS_BOUNDARY_ACTIVE", window.location.hostname);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolveGate = async () => {
      if (!supabase) {
        if (!cancelled) {
          setGate({
            ...EMPTY_GATE,
            loading: false,
            reason: "site_not_configured",
            hostname: window.location.hostname,
          });
        }
        return;
      }

      const { data, error } = await supabase.rpc("resolve_xos_admin_gate", {
        p_hostname: window.location.hostname,
      });
      const resolved = Array.isArray(data) ? data[0] : data;

      if (!cancelled) {
        setGate({
          loading: false,
          allowed: Boolean(resolved?.allowed),
          reason: error ? "site_not_configured" : resolved?.reason || "site_not_configured",
          tenant_slug: resolved?.tenant_slug || "",
          tenant_name: resolved?.tenant_name || "",
          hostname: resolved?.hostname || window.location.hostname,
        });
      }
    };

    if (!isLoadingAuth) {
      resolveGate();
    }

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated]);

  const redirectToXosRoot = () => {
    window.location.replace(`${window.location.origin}/`);
  };

  const signInWithGoogle = async () => {
    if (!supabase) {
      setSignInError("Sign-in is not configured for this workspace.");
      return;
    }

    setSignInError("");
    setSigningInWithGoogle(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });

    if (error) {
      setSignInError(error.message || "Google sign-in failed.");
      setSigningInWithGoogle(false);
    }
  };

  const signInWithPassword = async (event) => {
    event.preventDefault();

    if (!supabase) {
      setSignInError("Sign-in is not configured for this workspace.");
      return;
    }

    setSignInError("");
    setSigningInWithEmail(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setSignInError(error.message || "Email sign-in failed.");
      setSigningInWithEmail(false);
      return;
    }

    await checkAppState();
    redirectToXosRoot();
  };

  if (isLoadingAuth || gate.loading) {
    return (
      <>
        <BoundaryMarker />
        <AppLoader />
      </>
    );
  }

  if (gate.reason === "site_not_configured") {
    return (
      <GateState
        title="Site Not Configured"
        message="This XOS admin host is not connected to an active client workspace."
      />
    );
  }

  if (!isAuthenticated) {
    const loading = signingInWithEmail || signingInWithGoogle;

    return (
      <GateState
        title="Sign In Required"
        message="Sign in with an account that has access to this client workspace."
        action={
          <div className="mt-6 space-y-4">
            <form onSubmit={signInWithPassword} className="space-y-3">
              <label className="block text-sm font-medium text-zinc-700">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                />
              </label>
              <label className="block text-sm font-medium text-zinc-700">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {signingInWithEmail ? "Signing in..." : "Sign in with email"}
              </button>
            </form>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200" />
              or
              <span className="h-px flex-1 bg-zinc-200" />
            </div>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={loading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingInWithGoogle ? "Opening Google..." : "Continue with Google"}
            </button>
            {signInError && <p className="text-sm text-red-600">{signInError}</p>}
          </div>
        }
      />
    );
  }

  if (!gate.allowed) {
    return (
      <GateState
        title="Access Denied"
        message="Your signed-in account does not have access to this XOS workspace."
      />
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <BoundaryMarker />
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">XOS Admin</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{gate.tenant_name}</h1>
            <p className="mt-1 text-xs text-zinc-500">{gate.tenant_slug}</p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <p className="font-medium text-zinc-700">{user?.email || "Signed in"}</p>
            <p>Access confirmed for {gate.hostname}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-zinc-900">Workspace Shell</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
            This client-facing surface is gated by the configured host and your active tenant membership.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {MODULES.map(({ label, icon: Icon }) => (
            <article key={label} className="rounded-md border border-zinc-200 bg-white p-4">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
                <Icon className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="mt-2 text-xs leading-5 text-zinc-500">Coming soon</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
