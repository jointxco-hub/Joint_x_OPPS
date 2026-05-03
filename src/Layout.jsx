import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "./utils";
import {
  LayoutDashboard, Package, ClipboardList, BarChart2,
  Menu, X, ChevronRight, Boxes, Building2, Calculator,
  CreditCard, Archive, Settings, MoreHorizontal, Target,
  Search, Bell, User, ChevronDown, ShoppingCart, UserCircle,
  LogOut, Sparkles, DollarSign
} from "lucide-react";
import { dataClient } from "@/api/dataClient";
import { useAuth } from "@/lib/AuthContext";
import { isAdmin } from "@/lib/admin";
import NotificationsPanel from "@/components/common/NotificationsPanel";

const primaryNav = [
  { name: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
  { name: "My Hub", page: "UserDashboard", icon: UserCircle },
  { name: "Orders", page: "Orders", icon: Package },
  { name: "Tasks", page: "Tasks", icon: ClipboardList },
];

const moreNav = [
  { name: "Finance", page: "Executive", icon: BarChart2, adminOnly: true },
  { name: "Offers", page: "OffersDashboard", icon: Sparkles, adminOnly: true },
  { name: "Money Model", page: "MoneyModel", icon: DollarSign, adminOnly: true },
  { name: "Ops Calendar", page: "OpsCalendar", icon: Target },
  { name: "Inventory", page: "Inventory", icon: Boxes },
  { name: "Purchase Orders", page: "PurchaseOrders", icon: ShoppingCart },
  { name: "Suppliers", page: "Suppliers", icon: Building2 },
  { name: "Calculator", page: "Calculator", icon: Calculator },
  { name: "Archive", page: "Archive", icon: Archive },
  { name: "Settings", page: "RolesManagement", icon: Settings, adminOnly: true },
];

const STANDALONE_PAGES = ["TrackOrder", "ClientCatalog", "AletheaClientPortal", "SignIn"];

export default function Layout({ children, currentPageName }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(true);
  const [user, setUser] = useState(null);
  const location = useLocation();
  const { logout } = useAuth();

  useEffect(() => {
    dataClient.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    window.location.href = '/SignIn';
  };

  const visibleMoreNav = moreNav.filter(item => !item.adminOnly || isAdmin(user));

  useEffect(() => {
    setMobileMenuOpen(false);
    setMoreOpen(false);
  }, [location]);

  if (STANDALONE_PAGES.includes(currentPageName)) {
    return <>{children}</>;
  }

  const allNav = [...primaryNav, ...visibleMoreNav];
  const isMoreActive = visibleMoreNav.some(n => n.page === currentPageName);

  return (
    <div className="min-h-screen bg-background font-inter">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-[220px] lg:flex-col z-40">
        <div className="flex flex-col flex-1 bg-card border-r border-border shadow-apple-sm">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
            <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
              {/* Brand dots — mirroring the logo */}
              <div className="relative w-6 h-6">
                <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-[#1a7a5e]" />
                <span className="absolute bottom-0 left-0 w-2.5 h-2.5 rounded-full bg-[#b83a1a]" />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#c0a4e0]" />
              </div>
            </div>
            <div>
              <h1 className="font-bold text-foreground text-sm">Joint X</h1>
              <p className="text-xs text-muted-foreground">Operations OS</p>
            </div>
          </div>

          {/* Primary Nav */}
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-3 pb-2">Main</p>
            {primaryNav.map(item => {
              const isActive = currentPageName === item.page;
              return (
                <Link key={item.page} to={createPageUrl(item.page)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group
                    ${isActive ? 'bg-primary text-primary-foreground shadow-apple-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                >
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
                  {item.name}
                </Link>
              );
            })}

            <div className="pt-4 pb-2">
              <button
                onClick={() => setMoreOpen(v => !v)}
                className="flex items-center justify-between w-full px-3 pb-2 group"
              >
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">More</p>
                <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {moreOpen && visibleMoreNav.map(item => {
              const isActive = currentPageName === item.page;
              return (
                <Link key={item.page} to={createPageUrl(item.page)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group
                    ${isActive ? 'bg-primary text-primary-foreground shadow-apple-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                >
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User Profile */}
          {user && (
            <div className="p-3 border-t border-border">
              <div className="flex items-center justify-between px-2 pb-2">
                <NotificationsPanel />
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl">
                <div className="w-7 h-7 rounded-full bg-[#1a7a5e]/12 flex items-center justify-center flex-shrink-0">
                  <span className="text-[#1a7a5e] text-xs font-bold">
                    {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{user.full_name || 'User'}</p>
                  <p className="text-xs text-muted-foreground capitalize truncate">{user.role || 'user'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <div className="lg:hidden sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
              <div className="relative w-5 h-5">
                <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-[#1a7a5e]" />
                <span className="absolute bottom-0 left-0 w-2 h-2 rounded-full bg-[#b83a1a]" />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#c0a4e0]" />
              </div>
            </div>
            <span className="font-bold text-foreground text-sm">Joint X</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationsPanel />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-secondary text-foreground"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-card border-b border-border shadow-apple-lg max-h-[80vh] overflow-y-auto animate-slide-in-up">
            <nav className="p-3 grid grid-cols-2 gap-1">
              {allNav.map(item => {
                const isActive = currentPageName === item.page;
                return (
                  <Link key={item.page} to={createPageUrl(item.page)}
                    className={`flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm font-medium transition-all
                      ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      {/* Mobile Bottom Nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border safe-area-bottom">
        <div className="flex items-center justify-around px-2 py-2">
          {primaryNav.map(item => {
            const isActive = currentPageName === item.page;
            return (
              <Link key={item.page} to={createPageUrl(item.page)}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all
                  ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
                <span className={`text-xs font-medium ${isActive ? 'text-primary' : ''}`}>{item.name}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all
              ${isMoreActive ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:pl-[220px] pb-20 lg:pb-0">
        {children}
      </main>
    </div>
  );
}
