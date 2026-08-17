import { ShieldCheck } from 'lucide-react';

// Shared shell for every pre-workspace state (loading is handled
// separately by AppLoader). Deliberately generic - the invalid-tenant
// and unauthorized states must never reveal which tenant a host maps to,
// or why access was denied beyond a generic message.
export default function XOSGateScreen({ title, message, action }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12 text-zinc-950">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-white">
          <ShieldCheck className="h-5 w-5 text-zinc-700" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">XOS</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">{message}</p>
        {action}
      </div>
    </main>
  );
}
