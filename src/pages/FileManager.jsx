import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Folder, FolderPlus, File, Trash2, Edit2, MoreVertical,
  ArrowLeft, Upload, RefreshCw, Search, FolderOpen, Eye
} from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import FileThumbnail from "@/components/files/FileThumbnail.jsx";
import FileLightbox from "@/components/files/FileLightbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const folderColors = {
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-green-100 text-green-700 border-green-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
  red: "bg-red-100 text-red-700 border-red-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200"
};

export default function FileManager() {
  const [currentFolder, setCurrentFolder] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showEditFolder, setShowEditFolder] = useState(null);
  const [showMoveFile, setShowMoveFile] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [lightboxFile, setLightboxFile] = useState(null);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => base44.entities.Folder.list('-created_date', 500)
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['clientAssets'],
    queryFn: () => base44.entities.ClientAsset.list('-created_date', 500)
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('-created_date', 500)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 500)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 500)
  });

  const createFolderMutation = useMutation({
    mutationFn: (data) => base44.entities.Folder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setShowNewFolder(false);
      toast.success("Folder created!");
    }
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Folder.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setShowEditFolder(null);
      toast.success("Folder updated!");
    }
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id) => base44.entities.Folder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setDeleteConfirm(null);
      toast.success("Folder deleted");
    }
  });

  const moveFileMutation = useMutation({
    mutationFn: ({ fileId, folderId }) => 
      base44.entities.ClientAsset.update(fileId, { folder_id: folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets'] });
      setShowMoveFile(null);
      toast.success("File moved!");
    }
  });

  const deleteFileMutation = useMutation({
    mutationFn: (id) => base44.entities.ClientAsset.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientAssets'] });
      setDeleteConfirm(null);
      toast.success("File deleted");
    }
  });

  const currentFolders = folders.filter(f => 
    f.parent_folder_id === (currentFolder?.id || null)
  );

  const currentFiles = assets.filter(a => 
    a.folder_id === (currentFolder?.id || null) &&
    (!search || a.title?.toLowerCase().includes(search.toLowerCase()))
  );

  const breadcrumbs = [];
  let folder = currentFolder;
  while (folder) {
    breadcrumbs.unshift(folder);
    folder = folders.find(f => f.id === folder.parent_folder_id);
  }

  const getFolderContext = (folder) => {
    if (folder.client_id) {
      const client = clients.find(c => c.id === folder.client_id);
      return client ? `Client: ${client.name}` : null;
    }
    if (folder.project_id) {
      const project = projects.find(p => p.id === folder.project_id);
      return project ? `Project: ${project.name}` : null;
    }
    if (folder.order_id) {
      const order = orders.find(o => o.id === folder.order_id);
      return order ? `Order: ${order.order_number}` : null;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">File Manager</h1>
            <p className="text-slate-500 mt-1">Organize your files and folders</p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => {
                queryClient.invalidateQueries();
                toast.success("Refreshed!");
              }} 
              variant="ghost"
              size="icon"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button onClick={() => setShowNewFolder(true)}>
              <FolderPlus className="w-4 h-4 mr-2" /> New Folder
            </Button>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setCurrentFolder(null)}
            className={!currentFolder ? "font-semibold" : ""}
          >
            All Files
          </Button>
          {breadcrumbs.map((folder, i) => (
            <React.Fragment key={folder.id}>
              <span className="text-slate-400">/</span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setCurrentFolder(folder)}
                className={i === breadcrumbs.length - 1 ? "font-semibold" : ""}
              >
                {folder.name}
              </Button>
            </React.Fragment>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Folders Grid */}
        {currentFolders.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Folders</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {currentFolders.map(folder => (
                <Card 
                  key={folder.id} 
                  className={`cursor-pointer hover:shadow-md transition-shadow ${folderColors[folder.color] || folderColors.blue}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <FolderOpen 
                        className="w-8 h-8" 
                        onClick={() => setCurrentFolder(folder)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setShowEditFolder(folder)}>
                            <Edit2 className="w-4 h-4 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setDeleteConfirm({ type: 'folder', item: folder })}
                            className="text-red-600"
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <h4 
                      className="font-medium text-sm truncate"
                      onClick={() => setCurrentFolder(folder)}
                    >
                      {folder.name}
                    </h4>
                    {getFolderContext(folder) && (
                      <p className="text-xs mt-1 opacity-70 truncate">
                        {getFolderContext(folder)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Files Grid */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Files</h3>
          {currentFiles.length === 0 ? (
            <Card className="p-12 text-center bg-white">
              <File className="w-16 h-16 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-500">No files in this location</p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {currentFiles.map(file => (
                <Card key={file.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setLightboxFile(file)}>
                  <CardContent className="p-3">
                    <FileThumbnail 
                      fileUrl={file.file_url}
                      fileType={file.file_type}
                      title={file.title}
                      className="w-full h-32 mb-2"
                    />
                    <h4 className="font-medium text-sm mb-1 truncate">{file.title}</h4>
                    <p className="text-xs text-slate-500 capitalize mb-2">{file.asset_type}</p>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxFile(file);
                        }}
                      >
                        <Eye className="w-3 h-3" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreVertical className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            setShowMoveFile(file);
                          }}>
                            <FolderOpen className="w-4 h-4 mr-2" /> Move
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm({ type: 'file', item: file });
                            }}
                            className="text-red-600"
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Dialogs */}
        {showNewFolder && (
          <FolderFormDialog 
            onClose={() => setShowNewFolder(false)}
            onSubmit={(data) => createFolderMutation.mutate({
              ...data,
              parent_folder_id: currentFolder?.id || null
            })}
            clients={clients}
            orders={orders}
            projects={projects}
          />
        )}

        {showEditFolder && (
          <FolderFormDialog 
            folder={showEditFolder}
            onClose={() => setShowEditFolder(null)}
            onSubmit={(data) => updateFolderMutation.mutate({
              id: showEditFolder.id,
              data
            })}
            clients={clients}
            orders={orders}
            projects={projects}
          />
        )}

        {showMoveFile && (
          <MoveFileDialog 
            file={showMoveFile}
            folders={folders}
            onClose={() => setShowMoveFile(null)}
            onMove={(folderId) => moveFileMutation.mutate({
              fileId: showMoveFile.id,
              folderId
            })}
          />
        )}

        <ConfirmDialog 
          open={!!deleteConfirm}
          onOpenChange={() => setDeleteConfirm(null)}
          title={`Delete ${deleteConfirm?.type === 'folder' ? 'Folder' : 'File'}?`}
          description={
            deleteConfirm?.type === 'folder' 
              ? `This will delete the folder "${deleteConfirm?.item?.name}" and all its contents. This action cannot be undone.`
              : `Delete "${deleteConfirm?.item?.title}"? This action cannot be undone.`
          }
          confirmText="Delete"
          onConfirm={() => {
            if (deleteConfirm?.type === 'folder') {
              deleteFolderMutation.mutate(deleteConfirm.item.id);
            } else {
              deleteFileMutation.mutate(deleteConfirm.item.id);
            }
          }}
          variant="destructive"
        />

        {lightboxFile && (
          <FileLightbox 
            file={lightboxFile}
            onClose={() => setLightboxFile(null)}
          />
        )}
      </div>
    </div>
  );
}

function FolderFormDialog({ folder, onClose, onSubmit, clients, orders, projects }) {
  const [formData, setFormData] = useState(folder || {
    name: "",
    color: "blue",
    client_id: "",
    order_id: "",
    project_id: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? 'Edit Folder' : 'New Folder'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Folder Name *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
            />
          </div>

          <div>
            <Label>Color</Label>
            <Select value={formData.color} onValueChange={(v) => setFormData({...formData, color: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(folderColors).map(color => (
                  <SelectItem key={color} value={color}>
                    <span className="capitalize">{color}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Link to Client (optional)</Label>
            <Select value={formData.client_id} onValueChange={(v) => setFormData({...formData, client_id: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Select client..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {clients.map(client => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Link to Project (optional)</Label>
            <Select value={formData.project_id} onValueChange={(v) => setFormData({...formData, project_id: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Link to Order (optional)</Label>
            <Select value={formData.order_id} onValueChange={(v) => setFormData({...formData, order_id: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Select order..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {orders.map(order => (
                  <SelectItem key={order.id} value={order.id}>{order.order_number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{folder ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveFileDialog({ file, folders, onClose, onMove }) {
  const [selectedFolder, setSelectedFolder] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move "{file.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Select value={selectedFolder} onValueChange={setSelectedFolder}>
            <SelectTrigger>
              <SelectValue placeholder="Select destination folder..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Root (No Folder)</SelectItem>
              {folders.map(folder => (
                <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onMove(selectedFolder || null)}>Move File</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}