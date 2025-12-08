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
  Trash2, Plus, X, Download, File, Video
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

export default function ClientAssetsPanel({ orderId, clientName }) {
  const [showForm, setShowForm] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [newAsset, setNewAsset] = useState({
    title: "",
    description: "",
    asset_type: "mockup",
    is_client_visible: false,
    file_url: ""
  });

  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['clientAssets', orderId],
    queryFn: () => base44.entities.ClientAsset.filter({ order_id: orderId }, '-created_date', 100),
    enabled: !!orderId
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ClientAsset.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId] });
      setShowForm(false);
      setNewAsset({
        title: "",
        description: "",
        asset_type: "mockup",
        is_client_visible: false,
        file_url: ""
      });
      toast.success("Asset added!");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ClientAsset.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId] });
      toast.success("Asset deleted");
    }
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ id, visible }) => 
      base44.entities.ClientAsset.update(id, { is_client_visible: visible }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets', orderId] });
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
                  {ASSET_TYPES.map(type => (
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
          {assets.map(asset => {
            const Icon = getAssetIcon(asset.asset_type);
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
                  
                  {asset.description && (
                    <p className="text-xs text-slate-600 mb-2">{asset.description}</p>
                  )}
                  
                  <a 
                    href={asset.file_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700"
                  >
                    <Download className="w-3 h-3" />
                    View/Download
                  </a>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}