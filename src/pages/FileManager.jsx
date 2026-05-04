import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FolderPlus, FileText, File, Trash2, Pencil, Archive,
  Search, FolderOpen, ChevronRight, Download, FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import FileLightbox from "@/components/files/FileLightbox";

const FOLDER_COLORS = {
  blue:   { bg: "bg-blue-50",   icon: "text-blue-500",   hex: "#dbeafe" },
  green:  { bg: "bg-green-50",  icon: "text-green-500",  hex: "#f0fdf4" },
  purple: { bg: "bg-purple-50", icon: "text-purple-500", hex: "#faf5ff" },
  orange: { bg: "bg-orange-50", icon: "text-orange-500", hex: "#fff7ed" },
  red:    { bg: "bg-red-50",    icon: "text-red-500",    hex: "#fef2f2" },
  slate:  { bg: "bg-secondary", icon: "text-muted-foreground", hex: "#f1f5f9" },
};

function getFileExt(url, type) {
  if (type) return type.toLowerCase();
  if (!url) return null;
  const m = url.match(/\.([^.?]+)(\?|$)/);
  return m ? m[1].toLowerCase() : null;
}

function FilePill({ file }) {
  const ext = getFileExt(file.file_url, file.file_type);
  const isImage = ext && ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
  const isPdf = ext === "pdf";
  const isDoc = ext && ["doc", "docx"].includes(ext);
  const isSheet = ext && ["xls", "xlsx", "csv"].includes(ext);

  if (isImage) {
    return (
      <div className="w-full h-28 overflow-hidden bg-secondary">
        <img src={file.file_url} alt={file.title} className="w-full h-full object-cover" />
      </div>
    );
  }
  const colorClass = isPdf
    ? "bg-red-50 text-red-500"
    : isDoc
    ? "bg-blue-50 text-blue-500"
    : isSheet
    ? "bg-green-50 text-green-500"
    : "bg-secondary text-muted-foreground";
  const Icon = isPdf || isDoc ? FileText : isSheet ? FileSpreadsheet : File;
  const label = isPdf ? "PDF" : isDoc ? "DOC" : isSheet ? "SHEET" : (ext || "FILE").toUpperCase();

  return (
    <div className={`w-full h-28 flex flex-col items-center justify-center gap-1.5 ${colorClass}`}>
      <Icon className="w-8 h-8" />
      <span className="text-xs font-semibold tracking-wide">{label}</span>
    </div>
  );
}

export default function FileManager() {
  const [currentFolder, setCurrentFolder] = useState(null);
  const [lightboxFile, setLightboxFile] = useState(null);
  const [search, setSearch] = useState("");
  const [folderForm, setFolderForm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const qc = useQueryClient();

  const { data: folders = [] } = useQuery({
    queryKey: ["folders"],
    queryFn: () => dataClient.entities.Folder.list("-created_date", 500),
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["clientAssets"],
    queryFn: () => dataClient.entities.ClientAsset.list("-created_date", 500),
  });

  const createFolder = useMutation({
    mutationFn: (data) => dataClient.entities.Folder.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      setFolderForm(null);
      toast.success("Folder created");
    },
  });

  const updateFolder = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Folder.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      setFolderForm(null);
      toast.success("Folder updated");
    },
  });

  const archiveFolder = useMutation({
    mutationFn: (id) =>
      dataClient.entities.Folder.update(id, { is_archived: true, archived_at: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success("Folder archived");
    },
  });

  const deleteFolder = useMutation({
    mutationFn: (id) => dataClient.entities.Folder.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      setDeleteConfirm(null);
      toast.success("Folder deleted");
    },
  });

  const archiveFile = useMutation({
    mutationFn: (id) =>
      dataClient.entities.ClientAsset.update(id, { is_archived: true, archived_at: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientAssets"] });
      toast.success("File archived");
    },
  });

  const deleteFile = useMutation({
    mutationFn: (id) => dataClient.entities.ClientAsset.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientAssets"] });
      setDeleteConfirm(null);
      toast.success("File deleted");
    },
  });

  // Use parent_id — the correct field name in the Folder entity
  const visibleFolders = folders.filter(
    (f) => !f.is_archived && f.parent_id === (currentFolder?.id ?? null)
  );

  const visibleFiles = assets.filter(
    (a) =>
      !a.is_archived &&
      a.folder_id === (currentFolder?.id ?? null) &&
      (!search || a.title?.toLowerCase().includes(search.toLowerCase()))
  );

  const breadcrumbs = [];
  let f = currentFolder;
  while (f) {
    breadcrumbs.unshift(f);
    f = folders.find((x) => x.id === f.parent_id) ?? null;
  }

  const handleFolderSubmit = (name, color) => {
    if (folderForm && typeof folderForm === "object" && folderForm.id) {
      updateFolder.mutate({ id: folderForm.id, data: { name, color } });
    } else {
      createFolder.mutate({ name, color, parent_id: currentFolder?.id ?? null });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">File Manager</h1>
              <p className="text-muted-foreground text-sm">
                {visibleFolders.length} folder{visibleFolders.length !== 1 ? "s" : ""} ·{" "}
                {visibleFiles.length} file{visibleFiles.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <Button onClick={() => setFolderForm("new")} className="gap-2 rounded-xl shadow-apple-sm">
            <FolderPlus className="w-4 h-4" /> New Folder
          </Button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 mb-5 flex-wrap">
          <button
            onClick={() => setCurrentFolder(null)}
            className={`px-2 py-1 rounded-lg text-sm transition-all ${
              !currentFolder ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Files
          </button>
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <button
                onClick={() => setCurrentFolder(b)}
                className={`px-2 py-1 rounded-lg text-sm transition-all ${
                  i === breadcrumbs.length - 1
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl bg-card h-9"
          />
        </div>

        {/* Folders */}
        {visibleFolders.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Folders</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleFolders.map((folder) => {
                const col = FOLDER_COLORS[folder.color] || FOLDER_COLORS.blue;
                return (
                  <div
                    key={folder.id}
                    className="group bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden"
                  >
                    <button
                      className={`w-full p-4 flex items-center gap-3 ${col.bg} border-b border-border hover:opacity-80 transition-opacity`}
                      onClick={() => setCurrentFolder(folder)}
                    >
                      <FolderOpen className={`w-6 h-6 ${col.icon} flex-shrink-0`} />
                      <span className="text-sm font-semibold text-foreground truncate text-left">
                        {folder.name}
                      </span>
                    </button>
                    <div className="flex items-center justify-end gap-1 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setFolderForm(folder)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => archiveFolder.mutate(folder.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                        title="Archive"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ type: "folder", item: folder })}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Files</p>
          {visibleFiles.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-2xl border border-border">
              <File className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">No files here</h3>
              <p className="text-sm text-muted-foreground">Upload files through a Client or Order record</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleFiles.map((file) => (
                <div
                  key={file.id}
                  className="group bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden cursor-pointer"
                  onClick={() => setLightboxFile(file)}
                >
                  <FilePill file={file} />
                  <div className="p-3">
                    <p className="text-sm font-medium text-foreground truncate mb-0.5">{file.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">{file.file_type || "file"}</p>
                    <div
                      className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={file.file_url}
                        download
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                      <button
                        onClick={() => archiveFile.mutate(file.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                        title="Archive"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ type: "file", item: file })}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Folder form modal */}
      {folderForm !== null && (
        <FolderModal
          folder={typeof folderForm === "object" ? folderForm : null}
          onClose={() => setFolderForm(null)}
          onSubmit={handleFolderSubmit}
          isPending={createFolder.isPending || updateFolder.isPending}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-card rounded-2xl border border-border shadow-apple p-6 max-w-sm w-full">
            <h3 className="font-semibold text-foreground mb-2">
              Delete {deleteConfirm.type === "folder" ? "folder" : "file"}?
            </h3>
            <p className="text-sm text-muted-foreground mb-5">
              "{deleteConfirm.type === "folder" ? deleteConfirm.item.name : deleteConfirm.item.title}" will be
              permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-xl">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (deleteConfirm.type === "folder") deleteFolder.mutate(deleteConfirm.item.id);
                  else deleteFile.mutate(deleteConfirm.item.id);
                }}
                className="rounded-xl"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {lightboxFile && <FileLightbox file={lightboxFile} onClose={() => setLightboxFile(null)} />}
    </div>
  );
}

function FolderModal({ folder, onClose, onSubmit, isPending }) {
  const [name, setName] = useState(folder?.name || "");
  const [color, setColor] = useState(folder?.color || "blue");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-apple w-full max-w-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">{folder ? "Rename Folder" : "New Folder"}</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Folder name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Design Assets"
              className="rounded-xl"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && name.trim() && onSubmit(name.trim(), color)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(FOLDER_COLORS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setColor(key)}
                  style={{ backgroundColor: val.hex }}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    color === key ? "border-primary scale-110 shadow-sm" : "border-transparent"
                  }`}
                  title={key}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Cancel
          </Button>
          <Button
            onClick={() => name.trim() && onSubmit(name.trim(), color)}
            disabled={!name.trim() || isPending}
            className="rounded-xl"
          >
            {isPending ? "Saving…" : folder ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
