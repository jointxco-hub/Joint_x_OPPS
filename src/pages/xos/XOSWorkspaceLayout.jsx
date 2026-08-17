import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { FileText, FolderOpen, LayoutGrid, LogOut, Menu, Package, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import XOSErrorBoundary from './XOSErrorBoundary';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/requests', label: 'Requests', icon: FileText },
  { to: '/files', label: 'Files', icon: FolderOpen },
];

function initialsFor(name, email) {
  const source = (name || email || '').trim();
  if (!source) return 'X';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function NavLinks({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
            }`
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountMenu({ user, onLogout }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-zinc-950"
          aria-label="Account menu"
        >
          {initialsFor(user?.full_name, user?.email)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-xs text-zinc-400">Signed in as</p>
          <p className="truncate text-sm font-medium text-zinc-900">{user?.email || 'Account'}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="cursor-pointer gap-2 text-red-600 focus:text-red-600">
          <LogOut className="h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function XOSWorkspaceLayout({ gate }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    window.location.replace(`${window.location.origin}/`);
  };

  const currentPage = NAV_ITEMS.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-col border-r border-zinc-200 bg-white px-4 py-5 md:flex">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-zinc-950">XOS</p>
            <p className="truncate text-xs text-zinc-500">{gate.tenant_name || 'Workspace'}</p>
          </div>
        </div>
        <div className="mt-6 flex-1">
          <NavLinks />
        </div>
        <p className="px-2 text-[11px] text-zinc-400">Powered by Joint X</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 md:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="md:hidden">
              <p className="text-sm font-semibold leading-tight text-zinc-950">{currentPage?.label || 'XOS'}</p>
              <p className="truncate text-xs leading-tight text-zinc-500">{gate.tenant_name || 'Workspace'}</p>
            </div>
            <p className="hidden text-sm font-medium text-zinc-500 md:block">{currentPage?.label || ''}</p>
          </div>
          <AccountMenu user={user} onLogout={handleLogout} />
        </header>

        <main className="flex-1 overflow-x-hidden">
          <XOSErrorBoundary pageName={currentPage?.label} resetKey={location.pathname}>
            <Outlet />
          </XOSErrorBoundary>
        </main>
      </div>

      {/* Mobile nav drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-zinc-950">XOS</p>
              <p className="truncate text-xs text-zinc-500">{gate.tenant_name || 'Workspace'}</p>
            </div>
          </div>
          <div className="px-3 py-4">
            <NavLinks onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
