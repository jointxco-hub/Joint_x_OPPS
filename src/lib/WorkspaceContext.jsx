import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getCurrentTenantId, setCurrentTenantId } from '@/lib/tenantContext';
import { listMyOppsWorkspaces } from '@/lib/workspaceApi';

const WorkspaceContext = createContext(null);

function requestedTenantSlug() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('tenant') || '';
}

export function WorkspaceProvider({ children }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');

  const load = useCallback(async () => {
    if (isLoadingAuth) return;

    if (!isAuthenticated) {
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setWorkspaceError('');
      setIsLoadingWorkspace(false);
      return;
    }

    setIsLoadingWorkspace(true);
    setWorkspaceError('');

    try {
      const rows = await listMyOppsWorkspaces();
      if (!rows.length) {
        setWorkspaces([]);
        setCurrentWorkspace(null);
        setWorkspaceError('Your account does not have access to an OPPS workspace.');
        return;
      }

      const requestedSlug = requestedTenantSlug();
      if (requestedSlug) {
        const requested = rows.find((row) => row.slug === requestedSlug);
        if (!requested) {
          setWorkspaces(rows);
          setCurrentWorkspace(null);
          setWorkspaceError(`You do not have access to the "${requestedSlug}" workspace.`);
          return;
        }
        await setCurrentTenantId(requested.tenantId);
        setWorkspaces(rows);
        setCurrentWorkspace(requested);
        return;
      }

      const savedTenantId = await getCurrentTenantId().catch(() => null);
      const selected = rows.find((row) => row.tenantId === savedTenantId) || rows[0];
      if (selected.tenantId !== savedTenantId) {
        await setCurrentTenantId(selected.tenantId);
      }

      setWorkspaces(rows);
      setCurrentWorkspace(selected);
    } catch (error) {
      console.error('[WorkspaceContext] bootstrap failed', error);
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setWorkspaceError(error?.message || 'Unable to load your OPPS workspaces.');
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [isAuthenticated, isLoadingAuth]);

  useEffect(() => {
    load();
  }, [load]);

  const permissions = useMemo(
    () => new Set(Array.isArray(currentWorkspace?.permissions) ? currentWorkspace.permissions : []),
    [currentWorkspace]
  );

  const can = useCallback((permission) => {
    if (!permission) return true;
    return permissions.has('*') || permissions.has(permission);
  }, [permissions]);

  const switchWorkspace = useCallback(async (workspace) => {
    if (!workspace?.tenantId || workspace.tenantId === currentWorkspace?.tenantId) return;
    await setCurrentTenantId(workspace.tenantId);

    const url = new URL(window.location.href);
    url.searchParams.set('tenant', workspace.slug);
    // An order deep-link belongs to the old workspace. Never carry it into another tenant.
    url.searchParams.delete('open');
    url.searchParams.delete('orderId');
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }, [currentWorkspace?.tenantId]);

  const value = useMemo(() => ({
    workspaces,
    currentWorkspace,
    isLoadingWorkspace,
    workspaceError,
    can,
    switchWorkspace,
    refreshWorkspaces: load,
    isJointXWorkspace: !currentWorkspace || currentWorkspace.slug === 'joint-x',
  }), [workspaces, currentWorkspace, isLoadingWorkspace, workspaceError, can, switchWorkspace, load]);

  if (!isLoadingAuth && isAuthenticated && isLoadingWorkspace) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="rounded-2xl border border-border bg-card px-6 py-5 text-center shadow-apple-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Operations OS</p>
          <p className="mt-2 text-sm font-semibold text-foreground">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (!isLoadingAuth && isAuthenticated && workspaceError) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-apple-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Workspace access</p>
          <h1 className="mt-2 text-xl font-bold text-foreground">This workspace is not available.</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{workspaceError}</p>
          <button
            type="button"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete('tenant');
              url.searchParams.delete('open');
              url.searchParams.delete('orderId');
              window.location.assign(`${url.pathname}${url.search}${url.hash}`);
            }}
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open an available workspace
          </button>
        </div>
      </div>
    );
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider');
  }
  return value;
}
