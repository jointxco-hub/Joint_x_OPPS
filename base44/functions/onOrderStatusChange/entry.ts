import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    
    const { data, old_data, event } = body;
    
    if (!data || !old_data) {
      return Response.json({ ok: true, skipped: "missing data" });
    }

    const newStatus = data.status;
    const oldStatus = old_data.status;

    if (newStatus === oldStatus) {
      return Response.json({ ok: true, skipped: "status unchanged" });
    }

    // Fetch the status assignment rules from Role entities
    const roles = await base44.asServiceRole.entities.Role.list();
    const users = await base44.asServiceRole.entities.User.list();

    // Build auto-assign map from roles that have auto_assign_on_status field
    const statusRules = {};
    roles.forEach(role => {
      if (role.auto_assign_on_status && role.auto_assign_emails?.length > 0) {
        if (!statusRules[role.auto_assign_on_status]) {
          statusRules[role.auto_assign_on_status] = [];
        }
        statusRules[role.auto_assign_on_status].push(...role.auto_assign_emails);
      }
    });

    const assignees = statusRules[newStatus];
    if (!assignees || assignees.length === 0) {
      return Response.json({ ok: true, skipped: `no auto-assign rules for status: ${newStatus}` });
    }

    // Get unique current assigned team
    const currentTeam = Array.isArray(data.assigned_team) ? [...data.assigned_team] : [];
    const updatedTeam = [...new Set([...currentTeam, ...assignees])];

    if (updatedTeam.length === currentTeam.length && 
        updatedTeam.every(e => currentTeam.includes(e))) {
      return Response.json({ ok: true, skipped: "already assigned" });
    }

    await base44.asServiceRole.entities.Order.update(data.id, { assigned_team: updatedTeam });

    return Response.json({ 
      ok: true, 
      status: newStatus,
      assigned: assignees,
      total_team: updatedTeam
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});