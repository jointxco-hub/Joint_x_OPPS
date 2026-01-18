import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Upload, FileText, Image as ImageIcon, Eye, EyeOff, 
  Trash2, Plus, X, Download, File, Video,
  CheckCircle, XCircle, AlertCircle, Clock
} from "lucide-react";
import { toast } from "sonner";

const ASSET_TYPES = [
  { value: "mockup", label: "Mockup", icon: ImageIcon },
  { value: "tech_pack", label: "Tech Pack", icon: FileText },
  { value: "project_file", label: "Project File", icon: File },
  { value: "artwork", label: "Artwork", icon: ImageIcon },
  { value: "invoice", label: "Invoice", icon: FileText },
  { value: "note", label: "Note", icon: FileText },
  { value: "photo", label: "Photo", icon: ImageIcon },
  { value: "document", label: "Document", icon: FileText },
  { value: "other", label: "Other", icon: File }
];

const approvalStatusConfig = {
  pending: { label: "Pending Review", color: "bg-amber-100 text-amber-700", icon: Clock },
  approved: { label: "Approved", color: "bg-green-100 text-green-700", icon: CheckCircle },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700", icon: XCircle },
  needs_revision: { label: "Needs Revision", color: "bg-orange-100 text-orange-700", icon: AlertCircle }
};

export default function ClientAssetsPanel({ orderId, projectId, clientName, filterType }) {
  const [showForm, setShowForm] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  
  const getDefaultAssetType = () => {
    if (filterType === 'document') return 'document';
    if (filterType === 'artwork') return 'artwork';
    return 'mockup';
  };
  
  const [newAsset, setNewAsset] = useState({
    title: "",
    description: "",
    asset_type: getDefaultAssetType(),
    is_client_visible: false,
    file_url: "",
    approval_status: "pending"
  });

  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['clientAssets', orderId, projectId],
    queryFn: async () => {
      if (orderId) {
        return base44.entities.ClientAsset.filter({ order_id: orderId }, '-created_date', 100);
      } else if (projectId) {
        return base44.entities.ClientAsset.filter({ project_id: projectId }, '-created_date', 100);
      }
      return [];
    },
    enabled: !!(orderId || projectId)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ClientAsset.create(data),
    onSuccess: (newAsset) => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId, projectId] });
      // Force refetch to ensure new file shows immediately
      queryClient.refetchQueries({ queryKey: ['clientAssets', orderId, projectId] });
      setShowForm(false);
      setNewAsset({
        title: "",
        description: "",
        asset_type: "mockup",
        is_client_visible: false,
        file_url: "",
        approval_status: "pending"
      });
      toast.success("Asset added and visible!");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ClientAsset.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId, projectId] });
      toast.success("Asset deleted");
    }
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ id, visible }) => 
      base44.entities.ClientAsset.update(id, { is_client_visible: visible }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId, projectId] });
    }
  });

  const updateApprovalMutation = useMutation({
    mutationFn: ({ id, status }) => 
      base44.entities.ClientAsset.update(id, { approval_status: status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId, projectId] });
      toast.success("Approval status updated");
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setNewAsset({ ...newAsset, file_url, title: newAsset.title || file.name });
      toast.success("File uploaded!");
    } catch (error) {
      toast.error("Upload failed");
    } finally {
      setUploadingFile(false);
    }
  };

  const handleCreate = () => {
    if (!newAsset.title || !newAsset.file_url) {
      toast.error("Please add a title and file");
      return;
    }
    createMutation.mutate({
      ...newAsset,
      order_id: orderId,
      project_id: projectId,
      client_name: clientName
    });
  };

  const getAssetIcon = (type) => {
    const assetType = ASSET_TYPES.find(t => t.value === type);
    return assetType ? assetType.icon : File;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Client Assets</h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "Add Asset"}
        </Button>
      </div>

      {showForm && (
        <Card className="bg-slate-50">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2">
              <Label>Asset Type</Label>
              <Select 
                value={newAsset.asset_type} 
                onValueChange={(v) => setNewAsset({...newAsset, asset_type: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.filter(type => {
                    if (!filterType) return true;
                    if (filterType === 'document') {
                      return ['document', 'tech_pack', 'project_file', 'invoice', 'note', 'other'].includes(type.value);
                    }
                    if (filterType === 'artwork') {
                      return ['artwork', 'mockup', 'photo'].includes(type.value);
                    }
                    return type.value === filterType;
                  }).map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={newAsset.title}
                onChange={(e) => setNewAsset({...newAsset, title: e.target.value})}
                placeholder="Asset name..."
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={newAsset.description}
                onChange={(e) => setNewAsset({...newAsset, description: e.target.value})}
                placeholder="Optional notes..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Upload File *</Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('asset-upload').click()}
                disabled={uploadingFile}
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploadingFile ? "Uploading..." : newAsset.file_url ? "Change File" : "Choose File"}
              </Button>
              <input
                id="asset-upload"
                type="file"
                onChange={handleFileUpload}
                className="hidden"
              />
              {newAsset.file_url && (
                <p className="text-sm text-slate-500">✓ File uploaded</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="client-visible"
                checked={newAsset.is_client_visible}
                onChange={(e) => setNewAsset({...newAsset, is_client_visible: e.target.checked})}
                className="rounded"
              />
              <Label htmlFor="client-visible" className="cursor-pointer">
                Make visible to client
              </Label>
            </div>

            <Button 
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              Add Asset
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading assets...</p>
      ) : assets.length === 0 ? (
        <Card className="bg-slate-50">
          <CardContent className="p-8 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No assets yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {assets.filter(a => {
            if (!filterType) return true;
            if (filterType === 'document') {
              return ['document', 'tech_pack', 'project_file', 'invoice', 'note', 'other'].includes(a.asset_type);
            }
            if (filterType === 'artwork') {
              return ['artwork', 'mockup', 'photo'].includes(a.asset_type);
            }
            return a.asset_type === filterType;
          }).map(asset => {
            const Icon = getAssetIcon(asset.asset_type);
            const approvalConfig = approvalStatusConfig[asset.approval_status || 'pending'];
            const ApprovalIcon = approvalConfig.icon;
            
            return (
              <Card key={asset.id} className="bg-white">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5 text-slate-400" />
                      <div>
                        <h4 className="font-medium text-slate-900 text-sm">{asset.title}</h4>
                        <p className="text-xs text-slate-500 capitalize">{asset.asset_type}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleVisibilityMutation.mutate({ 
                          id: asset.id, 
                          visible: !asset.is_client_visible 
                        })}
                        className="h-8 w-8"
                      >
                        {asset.is_client_visible ? 
                          <Eye className="w-4 h-4 text-emerald-600" /> : 
                          <EyeOff className="w-4 h-4 text-slate-400" />
                        }
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(asset.id)}
                        className="h-8 w-8"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* Approval Status Badge */}
                  {asset.asset_type === 'artwork' && (
                    <div className="mb-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${approvalConfig.color}`}>
                        <ApprovalIcon className="w-3 h-3" />
                        {approvalConfig.label}
                      </span>
                    </div>
                  )}
                  
                  {asset.description && (
                    <p className="text-xs text-slate-600 mb-2">{asset.description}</p>
                  )}
                  
                  <a 
                    href={asset.file_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 mb-3"
                  >
                    <Download className="w-3 h-3" />
                    View/Download
                  </a>

                  {/* Approval Actions for Artwork */}
                  {asset.asset_type === 'artwork' && (
                    <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
                      <Button 
                        size="sm" 
                        onClick={() => updateApprovalMutation.mutate({ id: asset.id, status: 'approved' })}
                        className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs px-2"
                      >
                        <CheckCircle className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => updateApprovalMutation.mutate({ id: asset.id, status: 'needs_revision' })}
                        className="h-7 text-xs px-2"
                      >
                        <AlertCircle className="w-3 h-3 mr-1" /> Revision
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => updateApprovalMutation.mutate({ id: asset.id, status: 'rejected' })}
                        className="text-red-600 border-red-200 h-7 text-xs px-2"
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}