import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import PWAInstallPrompt from '@/components/common/PWAInstallPrompt'
import AppLoader from '@/components/common/AppLoader'
import GlobalRefreshControl from '@/components/common/GlobalRefreshControl'
import { pagesConfig } from './pages.config'
import { Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import XOSAdminShell from '@/pages/XOSAdminShell';
import { isXosAdminHost } from '@/lib/xosHost';
import { isStorefrontHost } from '@/lib/storefrontHost';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : () => <></>;
const SignInPage = Pages['SignIn'];
const TrackOrderPage = Pages['TrackOrder'];
const ClientCatalogPage = Pages['ClientCatalog'];

// Paths that are public - rendered without the internal layout and no auth check
const PUBLIC_PATHS = ['/TrackOrder', '/track', '/SignIn'];

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  currentPageName === 'ClientInvoicePrint'
    ? <>{children}</>
    : <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();
  const location = useLocation();

  // Public pages - bypass auth and layout entirely
  if (PUBLIC_PATHS.includes(location.pathname)) {
    return (
      <Suspense fallback={<AppLoader />}>
        <Routes>
          <Route path="/TrackOrder" element={TrackOrderPage ? <TrackOrderPage /> : <PageNotFound />} />
          <Route path="/track" element={TrackOrderPage ? <TrackOrderPage /> : <PageNotFound />} />
          <Route path="/SignIn" element={SignInPage ? <SignInPage /> : <PageNotFound />} />
        </Routes>
      </Suspense>
    );
  }
  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <AppLoader />;
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  // Redirect unauthenticated users to sign-in
  if (!isAuthenticated) {
    return <Navigate to={`/SignIn?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // Render the main app
  return (
    <Suspense fallback={<AppLoader />}>
      <Routes>
        <Route path="/" element={
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
          </LayoutWrapper>
        } />
        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            }
          />
        ))}
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Suspense>
  );
};


function XosOnlyApp() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Toaster />
        <XOSAdminShell />
      </QueryClientProvider>
    </AuthProvider>
  )
}

function StorefrontOnlyApp() {
  const path = window.location.pathname;
  const StorefrontPage = path === '/track' || path === '/TrackOrder'
    ? TrackOrderPage
    : ClientCatalogPage;

  return (
    <QueryClientProvider client={queryClientInstance}>
      <Suspense fallback={<AppLoader />}>
        {StorefrontPage ? <StorefrontPage /> : <PageNotFound />}
      </Suspense>
      <Toaster />
    </QueryClientProvider>
  )
}

function OppsApp() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
          <GlobalRefreshControl />
        </Router>
        <Toaster />
        <PWAInstallPrompt />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

function App() {
  if (isXosAdminHost()) {
    return <XosOnlyApp />
  }

  if (isStorefrontHost()) {
    return <StorefrontOnlyApp />
  }

  return <OppsApp />
}

export default App
