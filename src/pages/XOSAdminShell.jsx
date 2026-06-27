import { useEffect, useState } from "react";
import { BarChart3, FileText, FolderOpen, Package, Settings, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import AppLoader from "@/components/common/AppLoader";
import SignedFileLink from "@/components/common/SignedFileLink";
import { listXosFiles, listXosOrders, listXosRequests } from "@/lib/xosModules";

const MODULES = [
  { label: "Orders", icon: Package },
  { label: "Requests", icon: FileText },
  { label: "Files", icon: FolderOpen },
  { label: "Reports", icon: BarChart3 },
  { label: "Store Settings", icon: Settings },
];

const ACTIVE_MODULES = new Set(["Orders", "Requests", "Files"]);

const EMPTY_GATE = {
  loading: true,
  allowed: false,
  reason: "",
  tenant_slug: "",
  tenant_name: "",
  hostname: "",
};

const EMPTY_MODULE_STATE = {
  loading: false,
  orders: [],
  requests: [],
  files: [],
  ordersError: "",
  requestsError: "",
  filesError: "",
};

function BoundaryMarker() {
  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-full border border-emerald-200 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 shadow-sm backdrop-blur">
      XOS LIVE BUILD e05b880 ACTIVE | XOS Boundary Active
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

function formatDate(value) {
  if (!value) return "No date";
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "No date";
  }
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Amount pending";
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `R${Math.round(amount)}`;
  }
}

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "Size pending";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatItemCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return "Items pending";
  return `${count} item${count === 1 ? "" : "s"}`;
}

function StatusPill({ children }) {
  return (
    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium capitalize text-zinc-600">
      {String(children || "new").replaceAll("_", " ")}
    </span>
  );
}

function ModuleCard({ label, icon: Icon, active = false }) {
  return (
    <article
      className={`min-h-[132px] rounded-lg border bg-white p-4 transition ${
        active
          ? "border-emerald-200 shadow-sm shadow-emerald-900/5"
          : "border-zinc-200 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
          {active ? "Available now" : "Coming soon"}
        </span>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-950">{label}</h3>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        {active ? "Tenant-gated demo data for this workspace." : "Planned for a later XOS phase."}
      </p>
    </article>
  );
}

function LoadingRows({ label }) {
  return (
    <div className="space-y-3 px-4 py-5">
      <p className="text-sm text-zinc-500">Loading {label}...</p>
      <div className="h-14 rounded-md bg-zinc-100" />
      <div className="h-14 rounded-md bg-zinc-100" />
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="px-4 py-6 text-sm text-zinc-500">{children}</p>;
}

function ErrorState({ children }) {
  return <p className="px-4 py-6 text-sm text-red-600">{children}</p>;
}

export default function XOSAdminShell() {
  const { isLoadingAuth, isAuthenticated, user, checkAppState } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signingInWithEmail, setSigningInWithEmail] = useState(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false);
  const [gate, setGate] = useState(EMPTY_GATE);
  const [modules, setModules] = useState(EMPTY_MODULE_STATE);

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

  useEffect(() => {
    let cancelled = false;

    const loadModules = async () => {
      if (!gate.allowed || !gate.hostname) return;

      setModules((current) => ({
        ...current,
        loading: true,
        ordersError: "",
        requestsError: "",
        filesError: "",
      }));

      const [ordersResult, requestsResult, filesResult] = await Promise.all([
        listXosOrders({ hostname: window.location.hostname, limit: 20 }),
        listXosRequests({ hostname: window.location.hostname, limit: 20 }),
        listXosFiles({ hostname: window.location.hostname, limit: 20 }),
      ]);

      if (!cancelled) {
        setModules({
          loading: false,
          orders: ordersResult.data,
          requests: requestsResult.data,
          files: filesResult.data,
          ordersError: ordersResult.error || "",
          requestsError: requestsResult.error || "",
          filesError: filesResult.error || "",
        });
      }
    };

    loadModules();

    return () => {
      cancelled = true;
    };
  }, [gate.allowed, gate.hostname]);

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
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">XOS Workspace</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">Demo XOS Workspace</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              A secure client workspace for requests, files, and future store operations.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs text-zinc-500 sm:text-right">
            <p className="font-medium text-zinc-800">{user?.email || "Signed in"}</p>
            <p className="mt-1">Access confirmed for {gate.hostname}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{gate.tenant_name}</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">Workspace overview</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                This demo workspace shows how a client can access their own orders, requests, and private files through a tenant-gated XOS surface.
              </p>
            </div>
            <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              <p className="font-medium text-zinc-700">Tenant</p>
              <p className="mt-1">{gate.tenant_slug}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {MODULES.map(({ label, icon: Icon }) => (
            <ModuleCard key={label} label={label} icon={Icon} active={ACTIVE_MODULES.has(label)} />
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Orders</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Read-only demo order progress for this XOS workspace.</p>
            </div>
            <span className="w-fit rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Available now</span>
          </div>
          {modules.loading && <LoadingRows label="orders" />}
          {!modules.loading && modules.ordersError && <ErrorState>{modules.ordersError}</ErrorState>}
          {!modules.loading && !modules.ordersError && modules.orders.length === 0 && (
            <EmptyState>No demo orders yet.</EmptyState>
          )}
          {!modules.loading && !modules.ordersError && modules.orders.length > 0 && (
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {modules.orders.map((order) => (
                <article key={order.order_number} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-950">{order.order_number || "Demo order"}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">{order.client_name || "Client"}</p>
                    </div>
                    <StatusPill>{order.status}</StatusPill>
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-[40px] text-xs leading-5 text-zinc-600">
                    {order.summary || "Client-facing progress update pending."}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                    <div className="rounded-md bg-white px-3 py-2">
                      <p className="font-medium text-zinc-700">Stage</p>
                      <p className="mt-1 capitalize">{String(order.stage || "received").replaceAll("_", " ")}</p>
                    </div>
                    <div className="rounded-md bg-white px-3 py-2">
                      <p className="font-medium text-zinc-700">Items</p>
                      <p className="mt-1">{formatItemCount(order.item_count)}</p>
                    </div>
                    <div className="rounded-md bg-white px-3 py-2">
                      <p className="font-medium text-zinc-700">Created</p>
                      <p className="mt-1">{formatDate(order.created_at)}</p>
                    </div>
                    <div className="rounded-md bg-white px-3 py-2">
                      <p className="font-medium text-zinc-700">Due</p>
                      <p className="mt-1">{formatDate(order.due_date)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{formatCurrency(order.total_amount)}</span>
                    {order.tracking_reference && <span>Tracking {order.tracking_reference}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Requests</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">Client-facing demo requests for this XOS workspace.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Available now</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {modules.loading && <LoadingRows label="requests" />}
              {!modules.loading && modules.requestsError && <ErrorState>{modules.requestsError}</ErrorState>}
              {!modules.loading && !modules.requestsError && modules.requests.length === 0 && (
                <EmptyState>No demo requests yet.</EmptyState>
              )}
              {!modules.loading && !modules.requestsError && modules.requests.map((request) => (
                <article key={request.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900">{request.title || "Client request"}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{request.preview || "No preview"}</p>
                    </div>
                    <StatusPill>{request.status}</StatusPill>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span>{request.client_name || "Client"}</span>
                    <span aria-hidden="true">/</span>
                    <span className="capitalize">{String(request.request_type || "request").replaceAll("_", " ")}</span>
                    <span aria-hidden="true">/</span>
                    <span>{formatDate(request.created_at)}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Files</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">Private demo files open with short-lived signed links.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Available now</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {modules.loading && <LoadingRows label="files" />}
              {!modules.loading && modules.filesError && <ErrorState>{modules.filesError}</ErrorState>}
              {!modules.loading && !modules.filesError && modules.files.length === 0 && (
                <EmptyState>No demo files yet.</EmptyState>
              )}
              {!modules.loading && !modules.filesError && modules.files.map((file) => (
                <article key={file.id} className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900">{file.file_name || "Client file"}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {[file.folder_name, file.file_type, formatFileSize(file.file_size)].filter(Boolean).join(" / ")}
                      </p>
                      <p className="mt-2 text-[11px] text-zinc-500">{formatDate(file.created_at)}</p>
                    </div>
                    <SignedFileLink
                      url={file.file_ref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                    >
                      Open file
                    </SignedFileLink>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
