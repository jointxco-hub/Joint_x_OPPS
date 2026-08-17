import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useXosGate } from '@/lib/useXosGate';
import AppLoader from '@/components/common/AppLoader';
import XOSGateScreen from './xos/XOSGateScreen';
import XOSSignIn from './xos/XOSSignIn';
import XOSWorkspaceLayout from './xos/XOSWorkspaceLayout';
import XOSOverview from './xos/XOSOverview';
import XOSOrders from './xos/XOSOrders';
import XOSRequests from './xos/XOSRequests';
import XOSFiles from './xos/XOSFiles';

// Composition root for the XOS client workspace. Access-state ordering is
// unchanged from XOS 1 and must stay exactly this order:
//   1. loading (auth or gate still resolving)
//   2. site_not_configured (host doesn't map to an active tenant) - a
//      generic message only, no tenant details are available pre-auth
//      by design (resolve_xos_admin_gate withholds them)
//   3. not authenticated -> sign-in (checked BEFORE gate.allowed, so an
//      anonymous visitor never sees "access denied" - they see a normal
//      sign-in screen; this is the behavior verified live against
//      demo.xos.jointx.co.za during the XOS 1 cutover)
//   4. authenticated but !gate.allowed -> generic "no access" message
//   5. authorized -> the routed workspace
//
// XOS owns its own BrowserRouter here, independent of OPPS's router in
// App.jsx's OppsApp - the same path (e.g. "/orders") means something
// completely different under an XOS host than under the OPPS host.
export default function XOSAdminShell() {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  const gate = useXosGate(isLoadingAuth, isAuthenticated);

  if (isLoadingAuth || gate.loading) {
    return <AppLoader />;
  }

  if (gate.reason === 'site_not_configured') {
    return (
      <XOSGateScreen
        title="Site Not Configured"
        message="This XOS admin host is not connected to an active client workspace."
      />
    );
  }

  if (!isAuthenticated) {
    return <XOSSignIn />;
  }

  if (!gate.allowed) {
    return (
      <XOSGateScreen
        title="Access Denied"
        message="Your signed-in account does not have access to this XOS workspace."
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<XOSWorkspaceLayout gate={gate} />}>
          <Route index element={<XOSOverview gate={gate} />} />
          <Route path="orders" element={<XOSOrders gate={gate} />} />
          <Route path="requests" element={<XOSRequests gate={gate} />} />
          <Route path="files" element={<XOSFiles gate={gate} />} />
          <Route
            path="*"
            element={
              <XOSGateScreen
                title="Page not found"
                message="That page doesn't exist in this workspace."
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
