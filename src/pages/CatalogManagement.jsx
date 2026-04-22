import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Pencil, X, Image as ImageIcon, Plus, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "tshirts", label: "T-Shirts" },
  { value: "hoodies", label: "Hoodies" },
  { value: "sweaters", label: "Sweaters" },
  { value: "hats", label: "Hats" },
  { value: "bottoms", label: "Bottoms" },
  { value: "printing", label: "Printing" },
  { value: "labels", label: "Labels" }
];

export default function CatalogManagement() {
  const [editingItem, setEditingItem] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMultiple, setUploadingMultiple] = useState(false);
  const queryClient = useQueryClient();

  const { data: catalogItems = [], isLoading } = useQuery({
    queryKey: ['catalogItems'],
    queryFn: () => dataClient.entities.CatalogItem.list('display_order', 200)
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.CatalogItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogItems'] });
      setCreatingNew(false);
      toast.success("Product created!");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.CatalogItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogItems'] });
      setEditingItem(null);
      toast.success("Catalog item updated!");
    }
  });

  const handleImageUpload = async (e, item) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      await updateMutation.mutateAsync({ 
        id: item.id, 
        data: { ...item, image_url: file_url } 
      });
      toast.success("Image updated!");
    } catch (error) {
      toast.error("Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleUpdate = async (item) => {
    await updateMutation.mutateAsync({ id: item.id, data: item });
  };

  const handleCreate = async (item) => {
    await createMutation.mutateAsync(item);
  };

  const moveItem = async (item, direction) => {
    const currentOrder = item.display_order || 0;
    const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;
    await updateMutation.mutateAsync({ 
      id: item.id, 
      data: { ...item, display_order: newOrder } 
    });
  };

  const handleMultipleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadingMultiple(true);
    const uploadedUrls = [];

    for (const file of files) {
      try {
        const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
        uploadedUrls.push(file_url);
      } catch (error) {
        console.error("Upload failed:", error);
      }
    }

    setEditingItem({
      ...editingItem,
      images: [...(editingItem.images || []), ...uploadedUrls]
    });
    setUploadingMultiple(false);
    toast.success(`${uploadedUrls.length} images uploaded!`);
  };

  const removeImage = (index) => {
    const newImages = [...(editingItem.images || [])];
    newImages.splice(index, 1);
    setEditingItem({ ...editingItem, images: newImages });
  };

  const groupedItems = catalogItems.reduce((acc, item) => {
    const category = item.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  if (isLoading) {
    return <div className="p-8 text-center">Loading catalog...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Catalog Management</h1>
            <p className="text-slate-500 mt-1">Update product photos and details</p>
          </div>
          <Button onClick={() => setCreatingNew(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2" />
            New Product
          </Button>
        </div>

        {Object.entries(groupedItems).map(([category, items]) => (
          <div key={category} className="mb-12">
            <h2 className="text-xl font-semibold text-slate-800 mb-4 capitalize">
              {CATEGORIES.find(c => c.value === category)?.label || category}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map(item => (
                <Card key={item.id} className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
                  <div className="relative group">
                    <img 
                      src={item.image_url || "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400"} 
                      alt={item.name}
                      className="w-full aspect-square object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        size="sm"
                        onClick={() => document.getElementById(`upload-${item.id}`).click()}
                        disabled={uploadingImage}
                        className="bg-white text-slate-900 hover:bg-slate-100"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {uploadingImage ? "Uploading..." : "Change Photo"}
                      </Button>
                      <input
                        id={`upload-${item.id}`}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, item)}
                        className="hidden"
                      />
                    </div>
                  </div>
                  
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{item.name}</h3>
                        {item.code && <p className="text-sm text-slate-500">Code: {item.code}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => moveItem(item, 'up')}
                          className="h-8 w-8"
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => moveItem(item, 'down')}
                          className="h-8 w-8"
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingItem(item)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="space-y-1 text-sm text-slate-600">
                      {item.gsm && <p>GSM: {item.gsm}</p>}
                      {item.material && <p>Material: {item.material}</p>}
                      <p className="text-lg font-bold text-emerald-600 mt-2">
                        R{item.base_price}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}

        {/* Create Modal */}
        {creatingNew && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Create New Product</h2>
                  <Button variant="ghost" size="icon" onClick={() => setCreatingNew(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Product Name *</Label>
                    <Input
                      placeholder="e.g. JV1 T-Shirt"
                      onChange={(e) => setCreatingNew({ ...creatingNew, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Category *</Label>
                    <Select onValueChange={(v) => setCreatingNew({...creatingNew, category: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Product Code</Label>
                      <Input
                        placeholder="JV1"
                        onChange={(e) => setCreatingNew({...creatingNew, code: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Base Price (R) *</Label>
                      <Input
                        type="number"
                        placeholder="95"
                        onChange={(e) => setCreatingNew({...creatingNew, base_price: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" onClick={() => setCreatingNew(false)} className="flex-1">
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => handleCreate(creatingNew)} 
                      disabled={createMutation.isPending || !creatingNew.name || !creatingNew.category || !creatingNew.base_price}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      Create Product
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Edit Modal */}
        {editingItem && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Edit {editingItem.name}</h2>
                  <Button variant="ghost" size="icon" onClick={() => setEditingItem(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Product Name</Label>
                    <Input
                      value={editingItem.name}
                      onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Product Code</Label>
                    <Input
                      value={editingItem.code || ""}
                      onChange={(e) => setEditingItem({...editingItem, code: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select 
                      value={editingItem.category} 
                      onValueChange={(v) => setEditingItem({...editingItem, category: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>GSM</Label>
                      <Input
                        value={editingItem.gsm || ""}
                        onChange={(e) => setEditingItem({...editingItem, gsm: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Base Price (R)</Label>
                      <Input
                        type="number"
                        value={editingItem.base_price}
                        onChange={(e) => setEditingItem({...editingItem, base_price: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Material</Label>
                    <Input
                      value={editingItem.material || ""}
                      onChange={(e) => setEditingItem({...editingItem, material: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={editingItem.description || ""}
                      onChange={(e) => setEditingItem({...editingItem, description: e.target.value})}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Primary Image</Label>
                    {editingItem.image_url && (
                      <img 
                        src={editingItem.image_url} 
                        alt={editingItem.name}
                        className="w-full h-48 object-cover rounded-lg"
                      />
                    )}
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById(`edit-upload-${editingItem.id}`).click()}
                      disabled={uploadingImage}
                      className="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingImage ? "Uploading..." : "Upload Primary Image"}
                    </Button>
                    <input
                      id={`edit-upload-${editingItem.id}`}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, editingItem)}
                      className="hidden"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Additional Images</Label>
                    {editingItem.images && editingItem.images.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {editingItem.images.map((img, idx) => (
                          <div key={idx} className="relative group">
                            <img 
                              src={img} 
                              alt={`${editingItem.name} ${idx + 1}`}
                              className="w-full h-24 object-cover rounded"
                            />
                            <button
                              onClick={() => removeImage(idx)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById(`multi-upload-${editingItem.id}`).click()}
                      disabled={uploadingMultiple}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {uploadingMultiple ? "Uploading..." : "Add More Images"}
                    </Button>
                    <input
                      id={`multi-upload-${editingItem.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleMultipleImageUpload}
                      className="hidden"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Video URLs (Optional)</Label>
                    <p className="text-xs text-slate-500">Add YouTube or Vimeo links</p>
                    {editingItem.videos?.map((video, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          value={video}
                          onChange={(e) => {
                            const newVideos = [...(editingItem.videos || [])];
                            newVideos[idx] = e.target.value;
                            setEditingItem({ ...editingItem, videos: newVideos });
                          }}
                          placeholder="https://youtube.com/..."
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const newVideos = [...(editingItem.videos || [])];
                            newVideos.splice(idx, 1);
                            setEditingItem({ ...editingItem, videos: newVideos });
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingItem({
                        ...editingItem,
                        videos: [...(editingItem.videos || []), ""]
                      })}
                      className="w-full"
                    >
                      <Video className="w-4 h-4 mr-2" />
                      Add Video
                    </Button>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" onClick={() => setEditingItem(null)} className="flex-1">
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => handleUpdate(editingItem)} 
                      disabled={updateMutation.isPending}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      Save Changes
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
