import React, { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./utils";
import { 
  LayoutDashboard, Package, ClipboardList, Calculator, 
  Building2, Search, Menu, X, Shirt, ShoppingCart, Boxes,
  Store, BarChart2
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
  { name: "Executive", page: "Executive", icon: BarChart2 },
  { name: "Orders", page: "Orders", icon: Package },
  { name: "Tasks", page: "Tasks", icon: ClipboardList },
  { name: "Purchase Orders", page: "PurchaseOrders", icon: ShoppingCart },
  { name: "Inventory", page: "Inventory", icon: Boxes },
  { name: "Calculator", page: "Calculator", icon: Calculator },
  { name: "Suppliers", page: "Suppliers", icon: Building2 },
];

export default function Layout({ children, currentPageName }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Pages with their own layout
  if (currentPageName === "TrackOrder" || currentPageName === "ClientCatalog") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-1 bg-white border-r border-slate-200">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-100">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6930c24147ae0b4b6b9366fc/ec83cd269_Joint_xLogo.png" 
              alt="Joint X" 
              className="w-10 h-10 object-contain"
            />
            <div>
              <h1 className="font-bold text-slate-900">Joint X</h1>
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
                            ? 'bg-[#0F9B8E] text-white' 
                            : 'text-slate-600 hover:bg-[#0F9B8E]/10 hover:text-[#0F9B8E]'}
                  `}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Bottom Links */}
          <div className="p-4 border-t border-slate-100 space-y-2">
            <Link to={createPageUrl("ClientCatalog")}>
              <Button variant="outline" className="w-full justify-start gap-2">
                <Store className="w-4 h-4" />
                Client Catalog
              </Button>
            </Link>
            <Link to={createPageUrl("TrackOrder")}>
              <Button variant="outline" className="w-full justify-start gap-2">
                <Search className="w-4 h-4" />
                Order Tracking
              </Button>
            </Link>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6930c24147ae0b4b6b9366fc/ec83cd269_Joint_xLogo.png" 
                alt="Joint X" 
                className="w-9 h-9 object-contain"
              />
              <span className="font-bold text-slate-900">Joint X</span>
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
                          ? 'bg-[#0F9B8E] text-white' 
                          : 'text-slate-600 hover:bg-[#0F9B8E]/10'}
                    `}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                );
              })}
              <div className="border-t border-slate-100 pt-2 mt-2">
                <Link
                  to={createPageUrl("ClientCatalog")}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  <Store className="w-5 h-5" />
                  Client Catalog
                </Link>
                <Link
                  to={createPageUrl("TrackOrder")}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  <Search className="w-5 h-5" />
                  Order Tracking
                </Link>
              </div>
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