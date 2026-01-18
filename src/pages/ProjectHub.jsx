import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  ArrowLeft, AlertCircle, Package, FileText, 
  Image, Type, Clipboard, Users, DollarSign, TrendingUp, Plus
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import ClientAssetsPanel from "@/components/orders/ClientAssetsPanel";
import OrderLinker from "@/components/projects/OrderLinker";

export default function ProjectHub() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('id');

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const projects = await base44.entities.Project.filter({ id: projectId });
      return projects[0];
    },
    enabled: !!projectId
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['projectOrders', projectId],
    queryFn: () => base44.entities.Order.filter({ project_id: projectId }, '-created_date', 100),
    enabled: !!projectId
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['projectTasks', projectId],
    queryFn: () => base44.entities.Task.filter({ project_id: projectId }, '-created_date', 100),
    enabled: !!projectId
  });

  if (isLoading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>;
  }

  if (!project) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Project not found</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="mb-6">
          <Link to={createPageUrl('Projects')}>
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Projects
            </Button>
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">{project.name}</h1>
              <p className="text-slate-500">{project.client_name}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="bg-white border border-slate-200 p-1 rounded-xl mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="designs">Designs</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab project={project} orders={orders} tasks={tasks} />
          </TabsContent>

          <TabsContent value="notes">
            <NotesTab project={project} />
          </TabsContent>

          <TabsContent value="files">
            <FilesTab projectId={projectId} clientName={project.client_name} assetType="document" />
          </TabsContent>

          <TabsContent value="designs">
            <FilesTab projectId={projectId} clientName={project.client_name} assetType="artwork" />
          </TabsContent>

          <TabsContent value="orders">
            <OrdersTab orders={orders} projectId={projectId} clientName={project.client_name} />
          </TabsContent>

          <TabsContent value="people">
            <PeopleTab project={project} />
          </TabsContent>

          <TabsContent value="finance">
            <FinanceTab project={project} orders={orders} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function OverviewTab({ project, orders, tasks }) {
  const blockedOrders = orders.filter(o => o.stuck_reason && o.stuck_reason !== 'none');
  const activeOrders = orders.filter(o => !['delivered', 'archived'].includes(o.status));

  return (
    <div className="space-y-6">
      {project.blockers && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-900 mb-1">Project Blocker</h3>
                <p className="text-sm text-red-700">{project.blockers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500 mb-2">Goal</p>
            <p className="text-slate-900">{project.goal || 'No goal set'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500 mb-2">Status</p>
            <p className="text-slate-900 capitalize">{project.status}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500 mb-2">Priority</p>
            <p className="text-slate-900 capitalize">{project.priority}</p>
          </CardContent>
        </Card>
      </div>

      {blockedOrders.length > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4">
            <h3 className="font-semibold text-amber-900 mb-2">⚠️ Blocked Orders ({blockedOrders.length})</h3>
            <div className="space-y-2">
              {blockedOrders.map(order => (
                <div key={order.id} className="text-sm text-amber-700">
                  {order.order_number} - {order.stuck_reason.replace(/_/g, ' ')}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">Orders</h3>
            <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
            <p className="text-sm text-slate-500">{activeOrders.length} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">Tasks</h3>
            <p className="text-2xl font-bold text-slate-900">{tasks.length}</p>
            <p className="text-sm text-slate-500">{tasks.filter(t => t.status === 'pending').length} pending</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NotesTab({ project }) {
  const [notes, setNotes] = useState(project.notes || "");
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setIsSaving(true);
    await base44.entities.Project.update(project.id, { notes });
    queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    setIsSaving(false);
  };

  return (
    <Card>
      <CardContent className="p-6">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Project notes, decisions, context..."
          rows={15}
          className="mb-4"
        />
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Notes'}
        </Button>
      </CardContent>
    </Card>
  );
}

function FilesTab({ projectId, clientName, assetType }) {
  return (
    <Card>
      <CardContent className="p-6">
        <ClientAssetsPanel 
          orderId={null}
          projectId={projectId}
          clientName={clientName}
          filterType={assetType}
        />
      </CardContent>
    </Card>
  );
}

function OrdersTab({ orders, projectId, clientName }) {
  const [showOrderLinker, setShowOrderLinker] = useState(false);

  return (
    <div className="space-y-4">
      <Button onClick={() => setShowOrderLinker(true)} className="w-full">
        <Plus className="w-4 h-4 mr-2" /> Add Order to Project
      </Button>
      
      {orders.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No orders linked to this project</p>
        </Card>
      ) : (
        orders.map(order => (
          <Link key={order.id} to={createPageUrl(`Orders?order=${order.id}`)}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{order.order_number}</h3>
                    <p className="text-sm text-slate-500">{order.description}</p>
                  </div>
                  <Badge className="capitalize">{order.status.replace(/_/g, ' ')}</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))
      )}

      {showOrderLinker && (
        <OrderLinker 
          projectId={projectId}
          clientName={clientName}
          onClose={() => setShowOrderLinker(false)}
        />
      )}
    </div>
  );
}

function PeopleTab({ project }) {
  const teamMembers = project.team_members || [];

  return (
    <Card>
      <CardContent className="p-6">
        {teamMembers.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No team members assigned</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teamMembers.map((member, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-medium">{member.email}</p>
                  <p className="text-sm text-slate-500">{member.role}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FinanceTab({ project, orders }) {
  const totalQuoted = orders.reduce((sum, o) => sum + (o.quoted_price || 0), 0);
  const totalDeposits = orders.reduce((sum, o) => sum + (o.deposit_paid || 0), 0);
  const balance = totalQuoted - totalDeposits;

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-slate-500 mb-2">Total Quoted</p>
          <p className="text-2xl font-bold text-slate-900">R{totalQuoted.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-slate-500 mb-2">Deposits Paid</p>
          <p className="text-2xl font-bold text-green-600">R{totalDeposits.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-slate-500 mb-2">Balance Due</p>
          <p className="text-2xl font-bold text-slate-900">R{balance.toLocaleString()}</p>
        </CardContent>
      </Card>
    </div>
  );
}