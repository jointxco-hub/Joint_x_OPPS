import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  BookOpen, Plus, Search, Crown, AlertCircle, Clock, 
  CheckCircle2, ArrowLeft, Eye
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";

const criticalityColors = {
  critical: "bg-red-100 text-red-700 border-red-200",
  support: "bg-blue-100 text-blue-700 border-blue-200",
  optional: "bg-slate-100 text-slate-700 border-slate-200"
};

export default function SOPLibrary() {
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const queryClient = useQueryClient();

  const { data: sops = [] } = useQuery({
    queryKey: ['sops'],
    queryFn: () => dataClient.entities.SOP.list('-created_date', 500)
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => dataClient.entities.Role.list('-created_date', 100)
  });

  const activeSops = sops.filter(s => s.is_active);

  const filteredSops = activeSops.filter(sop => {
    const matchesSearch = !search || 
      sop.title?.toLowerCase().includes(search.toLowerCase()) ||
      sop.purpose?.toLowerCase().includes(search.toLowerCase());
    const matchesRole = !selectedRole || sop.role_id === selectedRole;
    return matchesSearch && matchesRole;
  });

  const sopsWithoutOwner = filteredSops.filter(s => !s.owner_email);
  const staleSOPs = filteredSops.filter(s => {
    if (!s.last_verified_date) return true;
    const daysSince = (new Date() - new Date(s.last_verified_date)) / (1000 * 60 * 60 * 24);
    return daysSince > 30;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to={createPageUrl("Operations")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">SOP Library</h1>
            <p className="text-slate-500 mt-1">{activeSops.length} standard operating procedures</p>
          </div>
          <Link to={createPageUrl("SOPEditor")}>
            <Button>
              <Plus className="w-4 h-4 mr-2" /> New SOP
            </Button>
          </Link>
        </div>

        {/* Alerts */}
        {(sopsWithoutOwner.length > 0 || staleSOPs.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {sopsWithoutOwner.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                    <h3 className="font-semibold text-orange-900">Missing Owners</h3>
                  </div>
                  <p className="text-sm text-orange-700">
                    {sopsWithoutOwner.length} SOPs need an accountable owner
                  </p>
                </CardContent>
              </Card>
            )}
            {staleSOPs.length > 0 && (
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-5 h-5 text-yellow-600" />
                    <h3 className="font-semibold text-yellow-900">Needs Verification</h3>
                  </div>
                  <p className="text-sm text-yellow-700">
                    {staleSOPs.length} SOPs not verified in 30+ days
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search SOPs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-md text-sm"
          >
            <option value="">All Roles</option>
            {roles.map(role => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </div>

        {/* SOPs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSops.map(sop => (
            <SOPCard key={sop.id} sop={sop} roles={roles} />
          ))}
        </div>

        {filteredSops.length === 0 && (
          <Card className="p-12 text-center">
            <BookOpen className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500">No SOPs found</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function SOPCard({ sop, roles }) {
  const role = roles.find(r => r.id === sop.role_id);
  const isStale = !sop.last_verified_date || 
    (new Date() - new Date(sop.last_verified_date)) / (1000 * 60 * 60 * 24) > 30;

  return (
    <Link to={createPageUrl(`SOPView?id=${sop.id}`)}>
      <Card className="hover:shadow-lg transition-shadow h-full cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-1 line-clamp-2">
                {sop.title}
              </h3>
              {role && (
                <p className="text-xs text-slate-500">{role.name}</p>
              )}
            </div>
            {sop.supports_qbr && (
              <Crown className="w-4 h-4 text-yellow-500 ml-2 flex-shrink-0" />
            )}
          </div>

          <p className="text-sm text-slate-600 mb-3 line-clamp-2">
            {sop.purpose}
          </p>

          <div className="flex flex-wrap gap-2 mb-3">
            <Badge className={criticalityColors[sop.criticality]}>
              {sop.criticality}
            </Badge>
            {sop.time_expectation && (
              <Badge variant="outline" className="text-xs">
                {sop.time_expectation}
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-1">
              {sop.owner_email ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <AlertCircle className="w-3 h-3 text-orange-500" />
              )}
              <span>{sop.owner_email ? 'Owned' : 'No owner'}</span>
            </div>
            {isStale && (
              <Badge variant="outline" className="text-orange-600 border-orange-600">
                Needs review
              </Badge>
            )}
            <span>v{sop.version}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
