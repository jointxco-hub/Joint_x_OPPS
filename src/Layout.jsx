import React, { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./utils";
import { 
  LayoutDashboard, Package, ClipboardList, Calculator, 
  Building2, Search, Menu, X, Shirt, ShoppingCart, Boxes
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
  { name: "Orders", page: "Orders", icon: Package },
  { name: "Tasks", page: "Tasks", icon: ClipboardList },
  { name: "Purchase Orders", page: "PurchaseOrders", icon: ShoppingCart },
  { name: "Inventory", page: "Inventory", icon: Boxes },
  { name: "Calculator", page: "Calculator", icon: Calculator },
  { name: "Suppliers", page: "Suppliers", icon: Building2 },
];

export default function Layout({ children, currentPageName }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Client tracking page has its own layout
  if (currentPageName === "TrackOrder") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-1 bg-white border-r border-slate-200">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-100">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
              <Shirt className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900">PrintFlow</h1>
              <p className="text-xs text-slate-500">Order Management</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map(item => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium
                    transition-all duration-200
                    ${isActive 
                      ? 'bg-slate-900 text-white' 
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}
                  `}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Client Portal Link */}
          <div className="p-4 border-t border-slate-100">
            <Link to={createPageUrl("TrackOrder")}>
              <Button variant="outline" className="w-full justify-start gap-2">
                <Search className="w-4 h-4" />
                Client Portal
              </Button>
            </Link>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center">
              <Shirt className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900">PrintFlow</span>
          </div>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-white border-b border-slate-200 shadow-lg max-h-[70vh] overflow-y-auto">
            <nav className="p-2 space-y-1">
              {navItems.map(item => {
                const isActive = currentPageName === item.page;
                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium
                      ${isActive 
                        ? 'bg-slate-900 text-white' 
                        : 'text-slate-600 hover:bg-slate-100'}
                    `}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                );
              })}
              <Link
                to={createPageUrl("TrackOrder")}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                <Search className="w-5 h-5" />
                Client Portal
              </Link>
            </nav>
          </div>
        )}
      </div>

      {/* Main Content */}
      <main className="lg:pl-64">
        {children}
      </main>
    </div>
  );
}