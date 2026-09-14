import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2, Check, ChevronDown, ShieldCheck, Users, X
} from 'lucide-react';
import { useWorkspace } from '@/lib/WorkspaceContext';
import {
  listWorkspaceMembers,
  listWorkspaceRoles,
  setWorkspaceMemberRole,
} from '@/lib/workspaceApi';

function labelFor(workspace) {
  return workspace?.workspaceConfig?.label || workspace?.name || 'Workspace';
}

function RoleManager({ onClose }) {
  const { currentWorkspace, refreshWorkspaces } = useWorkspace();
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    if (!currentWorkspace?.tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [memberRows, roleRows] = await Promise.all([
        listWorkspaceMembers(currentWorkspace.tenantId),
        listWorkspaceRoles(currentWorkspace.tenantId),
      ]);
      setMembers(memberRows);
      setRoles(roleRows);
    } catch (nextError) {
      setError(nextError?.message || 'Could not load workspace access.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentWorkspace?.tenantId]);

  const changeRole = async (member, roleKey) => {
    if (!member?.membershipId || !roleKey || member.roleKey === roleKey) return;
    const role = roles.find((item) => item.roleKey === roleKey);
    const confirmed = window.confirm(
      `Change ${member.name || member.email} from ${member.roleName || member.roleKey} to ${role?.name || roleKey}?`
    );
    if (!confirmed) return;

    setSavingId(member.membershipId);
    setError('');
    setNotice('');
    try {
      await setWorkspaceMemberRole(member.membershipId, roleKey);
      setNotice(`${member.name || member.email} is now ${role?.name || roleKey}.`);
      await load();
      await refreshWorkspaces();
    } catch (nextError) {
      setError(nextError?.message || 'Could not change this workspace role.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-apple-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Workspace access</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">{labelFor(currentWorkspace)}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Roles are tenant-specific. Café partners do not gain Joint X access unless they also have a Joint X membership.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4"/>
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800">{error}</div> : null}
          {notice ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">{notice}</div> : null}

          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading members and roles…</p>
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                  <Users className="mb-3 h-4 w-4 text-primary"/>
                  <p className="text-2xl font-bold text-foreground">{members.filter((m) => m.status === 'active').length}</p>
                  <p className="text-xs text-muted-foreground">Active members</p>
                </div>
                <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                  <ShieldCheck className="mb-3 h-4 w-4 text-primary"/>
                  <p className="text-2xl font-bold text-foreground">{roles.length}</p>
                  <p className="text-xs text-muted-foreground">Available roles</p>
                </div>
                <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                  <Building2 className="mb-3 h-4 w-4 text-primary"/>
                  <p className="truncate text-sm font-bold text-foreground">{currentWorkspace?.roleName}</p>
                  <p className="text-xs text-muted-foreground">Your role here</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border">
                {members.map((member) => (
                  <div key={member.membershipId} className="grid gap-3 border-b border-border p-4 last:border-b-0 sm:grid-cols-[1fr_220px] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{member.name || member.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      {member.status !== 'active' ? (
                        <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          {member.status}
                        </span>
                      ) : null}
                    </div>
                    <select
                      value={member.roleKey}
                      disabled={savingId === member.membershipId || member.status !== 'active'}
                      onChange={(event) => changeRole(member, event.target.value)}
                      className="h-10 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground"
                    >
                      {roles.map((role) => (
                        <option key={role.roleKey} value={role.roleKey}>{role.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl bg-secondary/40 p-4">
                <p className="text-xs font-semibold text-foreground">Role boundaries</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {roles.map((role) => (
                    <div key={role.roleKey} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-xs font-bold text-foreground">{role.name}</p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{role.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceSwitcher({ compact = false }) {
  const { workspaces, currentWorkspace, can, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const label = labelFor(currentWorkspace);
  const canManage = can('staff.manage');
  const multiple = workspaces.length > 1;

  const currentIndex = useMemo(
    () => workspaces.findIndex((item) => item.tenantId === currentWorkspace?.tenantId),
    [workspaces, currentWorkspace?.tenantId]
  );

  if (!currentWorkspace) return null;

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`flex w-full items-center gap-2 rounded-xl border border-border bg-background text-left transition hover:bg-secondary ${compact ? 'px-3 py-2' : 'px-3 py-2.5'}`}
        >
          <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4"/>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">{label}</p>
            <p className="truncate text-[10px] text-muted-foreground">{currentWorkspace.roleName}</p>
          </div>
          {(multiple || canManage) ? <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`}/> : null}
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[80] overflow-hidden rounded-2xl border border-border bg-card shadow-apple-lg">
            <div className="p-2">
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
              {workspaces.map((workspace, index) => {
                const selected = index === currentIndex;
                return (
                  <button
                    type="button"
                    key={workspace.tenantId}
                    onClick={() => {
                      setOpen(false);
                      switchWorkspace(workspace);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-secondary"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">{labelFor(workspace)}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{workspace.roleName}</p>
                    </div>
                    {selected ? <Check className="h-4 w-4 text-primary"/> : null}
                  </button>
                );
              })}
            </div>

            {canManage ? (
              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setManageOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
                >
                  <Users className="h-4 w-4 text-muted-foreground"/> Manage workspace access
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {manageOpen ? <RoleManager onClose={() => setManageOpen(false)}/> : null}
    </>
  );
}
