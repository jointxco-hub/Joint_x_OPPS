import { UserCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function MyRoleCard({ role }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 mb-1">
        <UserCircle2 className="w-3.5 h-3.5 text-primary" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">My Role</p>
      </div>
      {role ? (
        <>
          <div className="flex items-center gap-2">
            {role.icon && <span className="text-xl">{role.icon}</span>}
            <p className="text-sm font-bold text-foreground">{role.name}</p>
          </div>
          {Array.isArray(role.focus_areas) && role.focus_areas.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {role.focus_areas.slice(0, 3).map(area => (
                <span key={area} className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">
                  {area}
                </span>
              ))}
            </div>
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
