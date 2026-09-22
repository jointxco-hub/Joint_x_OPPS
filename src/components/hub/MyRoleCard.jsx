import { UserCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { deriveRoleCardView } from '@/lib/employeeIdentity';

export default function MyRoleCard({ role }) {
  const view = deriveRoleCardView(role);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 mb-1">
        <UserCircle2 className="w-3.5 h-3.5 text-primary" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">My Role</p>
      </div>
      {view ? (
        <>
          <div className="flex items-center gap-2">
            {view.emoji && <span className="text-xl">{view.emoji}</span>}
            <p className="text-sm font-bold text-foreground">{view.name}</p>
          </div>
          {view.purpose && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{view.purpose}</p>
          )}
        </>
      ) : (
        <Link to="/RolesManagement" className="text-xs text-primary hover:underline">
          Assign a primary role →
        </Link>
      )}
    </div>
  );
}
