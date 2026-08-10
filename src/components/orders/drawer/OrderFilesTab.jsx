import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Copy,
  FolderOpen,
  FolderPlus,
  Library,
  MoveRight,
  Paperclip,
  Pencil,
  Printer,
  Search,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { getInternalClientFileLibrary, saveInternalClientFileLink } from "@/api/clientRequests";
import FileLightbox from "@/components/files/FileLightbox";
import MediaPreview from "@/components/common/MediaPreview";
import { getSignedFileUrl, isPrivateFileReference } from "@/lib/privateFiles";
import { ORDER_ASSET_CATEGORIES } from "@/lib/orderAssetFolders";
import { resolveClientCategoryFromFolder, determineAlreadyLinkedState, buildBulkOrderFileLinkPatch } from "@/lib/clientAssetOrderLink";
import { INVOICE_FOLDER_ID, normalizeOrderFileFolders, mirrorOrderFileToClientAssetFolder, syncOrderFileCategoryToClientAsset } from "./OrderDrawerShared";
import { buildLightboxItems, isVisualFile, resolveLightboxIndex } from "@/lib/filePresentation";

const UNSORTED_FOLDER_ID = "__unsorted";

const fileUrlFrom = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.file_url || value.url || value.fileUrl || value.invoice_url || value.public_url || "").trim();
  }
  return String(value).trim();
};

const normalizeFileUrlList = (value) => (
  Array.isArray(value)
    ? Array.from(new Set(value.map(fileUrlFrom).filter(Boolean)))
    : []
);

const normalizeInvoiceFile = (invoice, index) => {
  if (!invoice) return null;
  if (typeof invoice === "string") {
    const url = fileUrlFrom(invoice);
    return url ? { id: `invoice-url-${index}`, file_url: url, name: url } : null;
  }
  if (typeof invoice === "object") {
    const url = fileUrlFrom(invoice);
    return {
      ...invoice,
      id: invoice.id || invoice.invoice_number || url || `invoice-${index}`,
      file_url: url,
    };
  }
  return null;
};

export default function OrderFilesTab({ order, onUpdate, uploadFile, uploading, onPrint }) {
  const safeOrder = order || {};
  const metadata = normalizeOrderFileFolders(safeOrder.order_file_folders);
  const queryClient = useQueryClient();
  const [openFolderId, setOpenFolderId] = useState("");
  const [textDialog, setTextDialog] = useState(null);
  const [linkDialog, setLinkDialog] = useState(null);
  const [copyDialog, setCopyDialog] = useState(null);
  const [preview, setPreview] = useState(null); // { files, index } | null
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const clientEmail = safeOrder.client_email || safeOrder.email || "";
  const { data: clientFileLibrary = { folders: [], files: [] }, isLoading: clientFilesLoading } = useQuery({
    queryKey: ["orderClientFileLibrary", clientEmail],
    queryFn: async () => {
      const result = await getInternalClientFileLibrary({ clientEmail, limit: 80 });
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    enabled: Boolean(clientEmail),
    staleTime: 30_000,
  });
  const fileUrls = normalizeFileUrlList(safeOrder.file_urls);
  const visibleUrls = normalizeFileUrlList(safeOrder.portal_visible_file_urls);
  const thumbnailUrl = safeOrder.production_thumbnail_url || "";
  const setAsThumbnail = (url) => onUpdate(safeOrder.id, { production_thumbnail_url: url });
  const clearThumbnail = () => onUpdate(safeOrder.id, { production_thumbnail_url: null });
  const invoices = Array.isArray(safeOrder.invoice_files) ? safeOrder.invoice_files.map(normalizeInvoiceFile).filter(Boolean) : [];
  const folders = Array.isArray(metadata.folders) ? metadata.folders : [];
  const currentFolder = folders.find((folder) => folder.id === openFolderId);
  const fileEntries = [
    ...fileUrls.map((url) => ({
      id: `file:${url}`,
      url,
      folderId: metadata.fileFolders?.[url] || "",
      isCopy: false,
    })),
    ...(metadata.fileCopies || [])
      .filter((copy) => fileUrls.includes(copy.url))
      .map((copy) => ({
        id: copy.id,
        url: copy.url,
        folderId: copy.folderId || "",
        label: copy.label || "",
        isCopy: true,
      })),
  ];
  const uncategorizedFiles = fileEntries.filter((entry) => !entry.folderId);
  const isUnsortedFolder = openFolderId === UNSORTED_FOLDER_ID;
  const isInvoiceFolder = openFolderId === INVOICE_FOLDER_ID;
  const currentFiles = openFolderId
    ? isUnsortedFolder
      ? uncategorizedFiles
      : fileEntries.filter((entry) => entry.folderId === openFolderId)
    : [];
  // Scopes FileLightbox's previous/next navigation to the visuals actually
  // shown in the currently open folder — never an unrelated collection.
  const currentVisualEntries = currentFiles.filter((entry) => isVisualFile(entry.url));
  const uploadTargetFolderId = openFolderId && !isInvoiceFolder && !isUnsortedFolder ? openFolderId : "";

  const saveMetadata = (next) => onUpdate(safeOrder.id, { order_file_folders: next });

  const createFolder = () => {
    setTextDialog({
      type: "create-folder",
      title: "New folder",
      description: "Create a folder for this order. Files stay as one source link and can be moved later.",
      label: "Folder name",
      value: "",
      action: "Create folder",
    });
  };

  const createFolderWithName = (name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const id = `folder-${Date.now().toString(36)}`;
    saveMetadata({ ...metadata, folders: [...folders, { id, name: clean }] });
    setOpenFolderId(id);
  };

  const renameFolder = (folderId) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    setTextDialog({
      type: "rename-folder",
      title: "Rename folder",
      description: "This changes the folder label only. Stored files are not moved or duplicated.",
      label: "Folder name",
      value: folder.name,
      action: "Save name",
      folderId,
    });
  };

  const renameFolderWithName = (folderId, name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    saveMetadata({
      ...metadata,
      folders: folders.map((item) => folderId === item.id ? { ...item, name: clean } : item),
    });
  };

  const deleteFolder = (folderId) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    if (!window.confirm(`Delete "${folder.name}" folder? Files stay attached and move back to All Files.`)) return;
    const nextFolders = { ...(metadata.fileFolders || {}) };
    Object.entries(nextFolders).forEach(([url, linkedFolderId]) => {
      if (linkedFolderId === folderId) delete nextFolders[url];
    });
    saveMetadata({
      ...metadata,
      folders: folders.filter((item) => item.id !== folderId),
      fileFolders: nextFolders,
      fileCopies: (metadata.fileCopies || []).filter((copy) => copy.folderId !== folderId),
      fileLabels: Object.fromEntries(Object.entries(metadata.fileLabels || {}).filter(([key]) => {
        const copy = (metadata.fileCopies || []).find((item) => item.id === key);
        return !copy || copy.folderId !== folderId;
      })),
    });
    if (openFolderId === folderId) setOpenFolderId("");
  };

  const moveFile = (entry, folderId) => {
    if (entry.isCopy) {
      saveMetadata({
        ...metadata,
        fileCopies: (metadata.fileCopies || []).map((copy) => (
          copy.id === entry.id ? { ...copy, folderId } : copy
        )),
      });
      setOpenFolderId(folderId || "");
      return;
    }

    const nextFolders = { ...(metadata.fileFolders || {}) };
    if (folderId) nextFolders[entry.url] = folderId;
    else delete nextFolders[entry.url];
    saveMetadata({ ...metadata, fileFolders: nextFolders });
    setOpenFolderId(folderId || "");
    // A real category move of the canonical order file — never for a
    // fileCopies placement (handled above, returns early) — keeps the
    // client library's categorization of that same shared file in sync.
    if (folderId && folderId !== INVOICE_FOLDER_ID) {
      syncOrderFileCategoryToClientAsset({ order: safeOrder, fileUrl: entry.url, folderId });
    }
  };

  const renameFile = (entry) => {
    setTextDialog({
      type: "rename-file",
      title: "Rename file label",
      description: "This changes the visible label in OPPS. The original storage file stays the same.",
      label: "File label",
      value: displayFileName(entry),
      action: "Save label",
      entry,
    });
  };

  const renameFileWithName = (entry, name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    saveMetadata({
      ...metadata,
      fileLabels: { ...(metadata.fileLabels || {}), [entry.id]: clean },
      fileCopies: (metadata.fileCopies || []).map((copy) => (
        copy.id === entry.id ? { ...copy, label: clean } : copy
      )),
    });
  };

  const copyFileToFolder = (entry) => {
    const targetFolders = folders.filter((folder) => folder.id !== entry.folderId);
    if (!targetFolders.length) {
      toast.info("Create another folder first");
      return;
    }
    setCopyDialog({ entry, folderId: targetFolders[0]?.id || "" });
  };

  const copyFileToFolderId = (entry, folderId) => {
    const target = folders.find((folder) => folder.id === folderId);
    if (!target) return;
    saveMetadata({
      ...metadata,
      fileCopies: [
        ...(metadata.fileCopies || []),
        {
          id: `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          url: entry.url,
          folderId: target.id,
          label: displayFileName(entry),
        },
      ],
    });
    setOpenFolderId(target.id);
  };

  const toggleClientVisible = (url, checked) => {
    onUpdate(safeOrder.id, {
      portal_visible_file_urls: checked
        ? Array.from(new Set([...visibleUrls, url]))
        : visibleUrls.filter((item) => item !== url),
    });
  };

  const pasteFileLink = (folderId = openFolderId) => {
    setLinkDialog({ folderId, url: "" });
  };

  const pasteFileLinkUrl = async (folderId = openFolderId, inputUrl = "") => {
    const url = String(inputUrl || "").trim();
    if (!url) return;
    const nextUrls = Array.from(new Set([...fileUrls, url]));
    const nextFolders = { ...(metadata.fileFolders || {}) };
    const existing = fileUrls.includes(url);
    const nextCopies = [...(metadata.fileCopies || [])];
    if (existing && folderId && folderId !== INVOICE_FOLDER_ID) {
      nextCopies.push({
        id: `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        url,
        folderId,
        label: displayFileName({ id: `file:${url}`, url }),
      });
    } else if (folderId && folderId !== INVOICE_FOLDER_ID) {
      nextFolders[url] = folderId;
    }
    onUpdate(safeOrder.id, {
      file_urls: nextUrls,
      order_file_folders: { ...metadata, fileFolders: nextFolders, fileCopies: nextCopies },
    });
    if (!existing) {
      mirrorOrderFileToClientAssetFolder({
        order: safeOrder,
        fileUrl: url,
        fileName: displayFileName({ id: `file:${url}`, url }),
        fileType: "",
        fileSize: undefined,
        folderId: folderId && folderId !== INVOICE_FOLDER_ID ? folderId : "",
      });
    }
    if (clientEmail) {
      const result = await saveInternalClientFileLink({
        clientEmail,
        fileUrl: url,
        fileName: displayFileName({ id: `file:${url}`, url }),
        linkedOrderId: safeOrder.id,
      });
      if (result.error) {
        toast.info("File linked to order, but client library link was not saved yet.");
      } else {
        queryClient.invalidateQueries({ queryKey: ["orderClientFileLibrary", clientEmail] });
        queryClient.invalidateQueries({ queryKey: ["newOrderClientFileLibrary", clientEmail] });
      }
    }
  };

  const linkClientFileToOrder = (file) => {
    const url = file.file_url;
    if (!url) return;
    const targetFolderId = uploadTargetFolderId;
    const nextUrls = Array.from(new Set([...fileUrls, url]));
    const nextFolders = { ...(metadata.fileFolders || {}) };
    const nextLabels = { ...(metadata.fileLabels || {}) };
    const nextCopies = [...(metadata.fileCopies || [])];
    const label = file.file_name || "Client account file";
    const exists = fileUrls.includes(url);

    if (targetFolderId && exists) {
      nextCopies.push({
        id: `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        url,
        folderId: targetFolderId,
        label,
      });
    } else if (targetFolderId) {
      nextFolders[url] = targetFolderId;
    }

    nextLabels[`file:${url}`] = label;

    onUpdate(safeOrder.id, {
      file_urls: nextUrls,
      order_file_folders: {
        ...metadata,
        fileFolders: nextFolders,
        fileLabels: nextLabels,
        fileCopies: nextCopies,
      },
    });
    if (!exists) {
      mirrorOrderFileToClientAssetFolder({
        order: safeOrder,
        fileUrl: url,
        fileName: label,
        fileType: file.file_type || "",
        fileSize: undefined,
        folderId: targetFolderId,
      });
    }
    toast.success(targetFolderId ? "Client file linked to this folder" : "Client file linked to this order");
  };

  // Bulk-links N already-existing canonical client_assets into this order
  // in one operation: no UploadFile call, no new ClientAsset rows, no
  // signed URL ever persisted — each selected asset's own file_url is
  // reused as-is via buildBulkOrderFileLinkPatch (src/lib/clientAssetOrderLink.js),
  // the same pure patch-builder the File Manager entry point (if present)
  // would also use, so this logic exists in exactly one place.
  const linkExistingClientAssets = (selectedAssets, categoryByFolderId) => {
    const { totalSelected, newlyLinkedCount, patch } = buildBulkOrderFileLinkPatch({
      fileUrls,
      orderFileFolders: metadata,
      selectedAssets,
      categoryByFolderId,
    });
    if (!totalSelected) return;
    onUpdate(safeOrder.id, patch);
    setShowLibraryPicker(false);
    if (newlyLinkedCount === 0) {
      toast.info("Those files are already linked to this order.");
    } else if (newlyLinkedCount < totalSelected) {
      toast.success(`${newlyLinkedCount} of ${totalSelected} selected files linked. The rest were already on this order. No files were re-uploaded.`);
    } else {
      toast.success(`${newlyLinkedCount} existing client file${newlyLinkedCount === 1 ? "" : "s"} linked. No files were re-uploaded.`);
    }
  };

  const submitTextDialog = (value) => {
    if (!textDialog) return;
    if (textDialog.type === "create-folder") createFolderWithName(value);
    if (textDialog.type === "rename-folder") renameFolderWithName(textDialog.folderId, value);
    if (textDialog.type === "rename-file") renameFileWithName(textDialog.entry, value);
    setTextDialog(null);
  };

  const submitLinkDialog = async (url) => {
    if (!linkDialog) return;
    await pasteFileLinkUrl(linkDialog.folderId, url);
    setLinkDialog(null);
  };

  const submitCopyDialog = (folderId) => {
    if (!copyDialog) return;
    copyFileToFolderId(copyDialog.entry, folderId);
    setCopyDialog(null);
  };

  const copyFileLink = async (url) => {
    try {
      const copyUrl = isPrivateFileReference(url) ? await getSignedFileUrl(url) : url;
      await navigator.clipboard.writeText(copyUrl || url);
      toast.success(isPrivateFileReference(url) ? "Secure file link copied" : "File link copied");
    } catch {
      toast.error("Could not copy file link");
    }
  };

  const removeFileLink = (entry) => {
    if (entry.isCopy) {
      saveMetadata({
        ...metadata,
        fileCopies: (metadata.fileCopies || []).filter((copy) => copy.id !== entry.id),
        fileLabels: Object.fromEntries(Object.entries(metadata.fileLabels || {}).filter(([key]) => key !== entry.id)),
      });
      return;
    }

    if (!window.confirm("Remove this file link from the order? The original storage file will not be deleted.")) return;
    const nextFolders = { ...(metadata.fileFolders || {}) };
    delete nextFolders[entry.url];
    const nextLabels = Object.fromEntries(Object.entries(metadata.fileLabels || {}).filter(([key]) => key !== entry.id));
    onUpdate(safeOrder.id, {
      file_urls: fileUrls.filter((item) => item !== entry.url),
      portal_visible_file_urls: visibleUrls.filter((item) => item !== entry.url),
      order_file_folders: {
        ...metadata,
        fileFolders: nextFolders,
        fileLabels: nextLabels,
        fileCopies: (metadata.fileCopies || []).filter((copy) => copy.url !== entry.url),
      },
    });
  };

  const invoiceUrl = (invoice) => fileUrlFrom(invoice);
  const invoiceTitle = (invoice, index) => invoice?.invoice_number || invoice?.file_name || invoice?.name || invoiceUrl(invoice).split("/").filter(Boolean).pop() || `Invoice ${index + 1}`;
  const displayFileName = (entryOrUrl) => {
    const entry = typeof entryOrUrl === "string" ? { id: `file:${entryOrUrl}`, url: entryOrUrl } : entryOrUrl;
    const safeEntry = entry || {};
    const override = metadata.fileLabels?.[safeEntry.id] || safeEntry.label;
    if (override) return override;
    try {
      const pathname = new URL(fileUrlFrom(safeEntry.url)).pathname;
      return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "File");
    } catch {
      return String(fileUrlFrom(safeEntry.url) || "File").split("/").filter(Boolean).pop() || "File";
    }
  };

  // Only a truly public reference can be rendered via a raw, unsigned <img
  // src> (used below for FolderPreview's small 4-up thumbnail grid) — a
  // private-upload://... or signed-only URL is excluded here regardless of
  // whether it's an image, same as before. Image-extension detection itself
  // now goes through the shared classifier rather than a local regex.
  const isImageUrl = (url) => !isPrivateFileReference(url) && isVisualFile(url);

  // Opens FileLightbox scoped to the CURRENT folder's visual entries only —
  // never an unrelated collection from elsewhere in the order.
  //
  // preserveIdentity: false is deliberate and unconditional here — every
  // `entry` in OrderFilesTab carries a UI-only id (`file:${url}`,
  // `copy-${...}` — see fileEntries above), never a real ClientAsset id.
  // Passing that id straight through would let FileLightbox believe an
  // arbitrary order file is a commentable, persisted ClientAsset row.
  const openGalleryPreview = (entries, clickedEntry) => {
    const items = buildLightboxItems(entries, { titleFrom: (item) => displayFileName(item), preserveIdentity: false });
    const startIndex = resolveLightboxIndex(items, clickedEntry?.url || clickedEntry);
    setPreview({ files: items, index: startIndex });
  };

  const openSinglePreview = (fileLike) => {
    setPreview({ files: buildLightboxItems([fileLike], { preserveIdentity: false }), index: 0 });
  };

  const FolderPreview = ({ urls = [], tone = "primary" }) => {
    const previewUrls = urls.filter(isImageUrl).slice(0, 4);
    const bgClass = tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary";
    if (!previewUrls.length) {
      return (
        <div className={`grid h-20 place-items-center rounded-2xl ${bgClass}`}>
          <FolderOpen className="h-7 w-7" />
        </div>
      );
    }
    return (
      <div className="grid h-20 grid-cols-2 gap-1 overflow-hidden rounded-2xl border border-border bg-secondary/30 p-1">
        {previewUrls.map((url, index) => (
          <img key={`${url}-${index}`} src={url} alt="" loading="lazy" className="h-full w-full rounded-xl object-cover" />
        ))}
        {previewUrls.length === 1 && <div className={`rounded-xl ${bgClass}`} />}
      </div>
    );
  };

  const FolderCard = ({ id, name, entries = [], tone = "primary", canManage = true }) => {
    const urls = entries.map((entry) => entry.url || entry).filter(Boolean);
    const count = entries.length;
    const clientVisibleCount = entries.filter((entry) => entry?.url && visibleUrls.includes(entry.url)).length;
    const isActive = openFolderId === id;
    const textClass = tone === "amber" ? "text-amber-800" : "text-primary";
    return (
      <div className={`rounded-3xl border bg-card p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        tone === "amber" ? "border-amber-200 hover:border-amber-300" : "border-border hover:border-primary/40"
      } ${isActive ? "ring-2 ring-primary/20" : ""}`}>
        <button type="button" onClick={() => setOpenFolderId(id)} className="block w-full text-left">
          <FolderPreview urls={urls} tone={tone} />
          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-primary/10 text-primary"}`}>
                  {count} item{count === 1 ? "" : "s"}
                </span>
                {clientVisibleCount > 0 && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {clientVisibleCount} client-visible
                  </span>
                )}
              </div>
            </div>
            <FolderOpen className={`mt-0.5 h-4 w-4 flex-shrink-0 ${textClass}`} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => setOpenFolderId(id)}
          className={`mt-3 w-full rounded-2xl px-3 py-2 text-xs font-semibold ${
            tone === "amber" ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          Open folder
        </button>
        {canManage && (
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => renameFolder(id)} className="rounded-xl bg-secondary/60 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">Rename</button>
            <button type="button" onClick={() => deleteFolder(id)} className="rounded-xl bg-secondary/60 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-red-600">Delete</button>
          </div>
        )}
      </div>
    );
  };

  const FileCard = ({ entry, index }) => (
    <div className={`rounded-2xl border bg-card p-2 shadow-sm transition-all hover:shadow-md ${
      visibleUrls.includes(entry.url) ? "border-primary/30" : "border-border"
    }`}>
      <MediaPreview
        url={entry.url}
        title={displayFileName(entry) || `Order file ${index + 1}`}
        onClick={() => entry.url && (
          isVisualFile(entry.url)
            ? openGalleryPreview(currentVisualEntries, entry)
            : openSinglePreview(entry)
        )}
      />
      <div className="mt-2 space-y-2">
        <div className="flex items-start justify-between gap-2 px-1">
          <p className="truncate text-xs font-semibold text-foreground" title={displayFileName(entry)}>
            {displayFileName(entry)}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {visibleUrls.includes(entry.url) && (
              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">client</span>
            )}
            {entry.isCopy && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">linked</span>}
          </div>
        </div>
        {entry.isCopy && (
          <p className="px-1 text-[11px] leading-4 text-muted-foreground">Same storage file, linked into this folder. No duplicate binary was created.</p>
        )}
        {isVisualFile(entry.url) && (
          <button
            type="button"
            onClick={() => (thumbnailUrl === entry.url ? clearThumbnail() : setAsThumbnail(entry.url))}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${
              thumbnailUrl === entry.url
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${thumbnailUrl === entry.url ? "fill-amber-500 text-amber-500" : ""}`} />
            {thumbnailUrl === entry.url ? "Order thumbnail" : "Set as thumbnail"}
          </button>
        )}
        <button
          type="button"
          onClick={() => renameFile(entry)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename label
        </button>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2 text-xs">
          <span>
            <span className="block font-medium text-foreground">Show in client tracker</span>
            <span className="text-[11px] text-muted-foreground">Only selected files appear on X LAB</span>
          </span>
          <input
            type="checkbox"
            checked={visibleUrls.includes(entry.url)}
            onChange={(e) => toggleClientVisible(entry.url, e.target.checked)}
          />
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
          <MoveRight className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={entry.folderId || ""}
            onChange={(e) => moveFile(entry, e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
          >
            <option value="">All Files</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => copyFileLink(entry.url)}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={() => copyFileToFolder(entry)}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            Link to...
          </button>
        </div>
        <button
          type="button"
          onClick={() => removeFileLink(entry)}
          className="w-full rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600"
        >
          {entry.isCopy ? "Remove folder link" : "Remove file link"}
        </button>
      </div>
    </div>
  );

  const InvoiceCard = ({ invoice, index }) => {
    const url = invoiceUrl(invoice);
    return (
      <div className="rounded-2xl border border-border bg-card p-2">
        {url ? (
          <MediaPreview
            url={url}
            title={invoiceTitle(invoice, index)}
            onClick={() => url && openSinglePreview({
              title: invoiceTitle(invoice, index),
              file_url: url,
              file_type: invoice?.file_type || "application/pdf",
            })}
          />
        ) : (
          <div className="grid aspect-square place-items-center rounded-xl border border-border bg-secondary/30 text-xs text-muted-foreground">
            No invoice file
          </div>
        )}
        <div className="mt-2 rounded-xl bg-secondary/40 px-3 py-2">
          <p className="truncate text-xs font-semibold text-foreground">{invoiceTitle(invoice, index)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {invoice?.invoice_total ? `R${Number(invoice.invoice_total).toLocaleString()}` : "Invoice / quote"}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-secondary/20 p-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Order files</p>
          <p className="text-xs text-muted-foreground">
            One source file can be linked into multiple folders. Only files marked client-visible show in X LAB.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              {fileUrls.length} file{fileUrls.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
              {visibleUrls.length} client-visible
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onPrint?.("mockups")}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-primary/40"
        >
          <Printer className="h-3.5 w-3.5" />
          Print mockups
        </button>
      </div>

      {isInvoiceFolder ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          Invoice and quote files are managed from the invoice/quote workflow, not added here. Upload, paste-link,
          and client-account linking are unavailable while viewing this folder so a file can never look like it was
          added to Invoices &amp; Quotes when it wasn't.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block cursor-pointer">
              <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-4 transition-all hover:border-primary/40">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Upload files"}</span>
              </div>
              <input type="file" className="hidden" multiple onChange={(e) => uploadFile(e, uploadTargetFolderId)} disabled={uploading} />
            </label>
            <button
              type="button"
              onClick={() => pasteFileLink(openFolderId)}
              className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm font-medium text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground"
            >
              <Copy className="h-4 w-4" />
              Paste file link
            </button>
            <button
              type="button"
              onClick={() => setShowLibraryPicker(true)}
              disabled={!safeOrder.client_id}
              className="flex items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm font-medium text-primary transition-all hover:border-primary/50 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
              title={safeOrder.client_id ? undefined : "This order has no linked client yet"}
            >
              <Library className="h-4 w-4" />
              Add from client library
            </button>
          </div>

          <ClientAccountFilesPanel
            library={clientFileLibrary}
            loading={clientFilesLoading}
            currentOrderUrls={fileUrls}
            folders={folders}
            onLink={linkClientFileToOrder}
            onPreview={(file) => openSinglePreview({
              title: file.file_name || "Client file",
              file_url: file.file_url,
              file_type: file.file_type,
            })}
          />
        </>
      )}

      {!openFolderId ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folders</p>
              <p className="text-xs text-muted-foreground">Move file links without duplicating the stored file.</p>
            </div>
            <button
              type="button"
              onClick={createFolder}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <FolderCard id={UNSORTED_FOLDER_ID} name="Unsorted files" entries={uncategorizedFiles} canManage={false} />
            {folders.map((folder) => {
              const folderEntries = fileEntries.filter((entry) => entry.folderId === folder.id);
              return (
                <FolderCard
                  key={folder.id}
                  id={folder.id}
                  name={folder.name}
                  entries={folderEntries}
                />
              );
            })}
            <FolderCard
              id={INVOICE_FOLDER_ID}
              name="Invoices & Quotes"
              entries={invoices.map((invoice, index) => invoiceUrl(invoice) || invoiceTitle(invoice, index))}
              tone="amber"
              canManage={false}
            />
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setOpenFolderId("")}
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40"
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            Back to folders
          </button>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isInvoiceFolder ? "Invoices & Quotes" : isUnsortedFolder ? "Unsorted files" : currentFolder?.name || "Folder"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isInvoiceFolder ? invoices.length : currentFiles.length} item{(isInvoiceFolder ? invoices.length : currentFiles.length) === 1 ? "" : "s"}
              </p>
            </div>
            {!isInvoiceFolder && !isUnsortedFolder && currentFolder && (
              <div className="flex gap-2">
                <button type="button" onClick={() => renameFolder(currentFolder.id)} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40">Rename</button>
                <button type="button" onClick={() => deleteFolder(currentFolder.id)} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600">Delete</button>
              </div>
            )}
          </div>
          {isInvoiceFolder ? (
            invoices.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {invoices.map((invoice, index) => <InvoiceCard key={invoice?.id || invoiceUrl(invoice) || index} invoice={invoice} index={index} />)}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No invoices or quotes linked.</p>
            )
          ) : currentFiles.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {currentFiles.map((entry, index) => <FileCard key={entry.id} entry={entry} index={index} />)}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">This folder is empty.</p>
          )}
        </div>
      )}

      {fileUrls.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No files attached</p>
      )}

      {textDialog && (
        <TextActionModal
          title={textDialog.title}
          description={textDialog.description}
          label={textDialog.label}
          value={textDialog.value}
          action={textDialog.action}
          onClose={() => setTextDialog(null)}
          onSubmit={submitTextDialog}
        />
      )}

      {linkDialog && (
        <TextActionModal
          title="Paste file link"
          description="Add a Supabase Storage URL or external reference link. This links the file to the order without uploading a duplicate."
          label="File URL"
          value={linkDialog.url}
          action="Add link"
          inputMode="url"
          onClose={() => setLinkDialog(null)}
          onSubmit={submitLinkDialog}
        />
      )}

      {copyDialog && (
        <FolderPickerModal
          title="Link file to folder"
          description="Create another folder link to the same source file. This does not duplicate the file binary."
          folders={folders.filter((folder) => folder.id !== copyDialog.entry?.folderId)}
          value={copyDialog.folderId}
          onChange={(folderId) => setCopyDialog((current) => ({ ...current, folderId }))}
          onClose={() => setCopyDialog(null)}
          onSubmit={submitCopyDialog}
        />
      )}
      {preview && (
        <FileLightbox
          files={preview.files}
          index={preview.index}
          onIndexChange={(nextIndex) => setPreview((current) => (current ? { ...current, index: nextIndex } : current))}
          onClose={() => setPreview(null)}
        />
      )}
      {showLibraryPicker && (
        <ClientLibraryPickerModal
          clientId={safeOrder.client_id}
          currentOrderUrls={fileUrls}
          onClose={() => setShowLibraryPicker(false)}
          onLink={linkExistingClientAssets}
        />
      )}
    </div>
  );
}

function TextActionModal({ title, description, label, value = "", action = "Save", inputMode = "text", onClose, onSubmit }) {
  const [draft, setDraft] = useState(value || "");
  const clean = String(draft || "").trim();

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form
        className="w-full max-w-sm rounded-3xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!clean) return;
          onSubmit(clean);
        }}
      >
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
        </div>
        <div className="space-y-2 p-5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            inputMode={inputMode}
            autoFocus
            className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex gap-2 border-t border-border p-3">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-2xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button type="submit" disabled={!clean} className="h-10 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40">
            {action}
          </button>
        </div>
      </form>
    </div>
  );
}

function FolderPickerModal({ title, description, folders, value, onChange, onClose, onSubmit }) {
  const [selected, setSelected] = useState(value || folders[0]?.id || "");

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form
        className="w-full max-w-sm rounded-3xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected) return;
          onSubmit(selected);
        }}
      >
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
        </div>
        <div className="space-y-2 p-5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folder</label>
          <select
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              onChange?.(event.target.value);
            }}
            className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 border-t border-border p-3">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-2xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button type="submit" disabled={!selected} className="h-10 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40">
            Link file
          </button>
        </div>
      </form>
    </div>
  );
}

function ClientAccountFilesPanel({ library, loading, currentOrderUrls, onLink, onPreview }) {
  const files = Array.isArray(library?.files) ? library.files : [];
  const folders = Array.isArray(library?.folders) ? library.folders : [];
  const folderName = (folderId) => folders.find((folder) => folder.id === folderId)?.name || "References";
  const grouped = files.reduce((acc, file) => {
    const name = folderName(file.folder_id);
    if (!acc[name]) acc[name] = [];
    acc[name].push(file);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">X LAB account uploads</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading client uploads...</p>
      </div>
    );
  }

  if (!files.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">X LAB account uploads</p>
          <p className="mt-1 text-xs text-muted-foreground">Files uploaded from X LAB account. Link them to this order without re-uploading.</p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          {files.length} available
        </span>
      </div>
      <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
        {Object.entries(grouped).map(([folder, folderFiles]) => (
          <div key={folder} className="rounded-2xl bg-secondary/30 p-2">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold text-foreground">{folder}</p>
              <span className="text-[11px] text-muted-foreground">{folderFiles.length} item{folderFiles.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {folderFiles.map((file) => {
                const fileUrl = fileUrlFrom(file);
                const alreadyLinked = currentOrderUrls.includes(fileUrl);
                return (
                  <div key={file.id} className="rounded-xl border border-border bg-background p-2">
                    <div className="flex gap-2">
                      <MediaPreview
                        url={fileUrl}
                        title={file.file_name || "Client file"}
                        className="h-16 w-16 shrink-0 rounded-xl"
                        onClick={() => onPreview(file)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground" title={file.file_name}>{file.file_name || "Client file"}</p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{file.file_type || "file"}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Tap thumbnail to preview</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onLink(file)}
                      className={`mt-2 w-full rounded-full px-3 py-1.5 text-xs font-semibold ${
                        alreadyLinked
                          ? "bg-secondary text-muted-foreground hover:text-foreground"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      }`}
                    >
                      {alreadyLinked ? "Link again to folder" : "Link to order"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The canonical Phase 1A.1 reuse flow: browse/search this client's own
// canonical File Manager library (folders/client_assets — NOT the
// email-keyed client_file_links API ClientAccountFilesPanel above still
// uses) and bulk-link many existing files into this order in one action,
// with zero UploadFile calls and zero new ClientAsset rows.
function ClientLibraryPickerModal({ clientId, currentOrderUrls, onClose, onLink }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // dataClient.entities is built dynamically (see src/api/dataClient.js),
  // so TS can't statically resolve its keys — same local `any` boundary
  // used throughout this codebase (e.g. OrderLinkPanel.jsx's orderEntity,
  // OrderDrawerShared.jsx's clientAssetEntity()).
  const folderEntity = /** @type {any} */ (dataClient.entities).Folder;
  const clientAssetEntity = /** @type {any} */ (dataClient.entities).ClientAsset;

  const { data: clientFolders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["clientLibraryFolders", clientId],
    queryFn: () => folderEntity.filter({ client_id: clientId }, undefined, 500),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const { data: clientAssets = [], isLoading: assetsLoading } = useQuery({
    queryKey: ["clientLibraryAssets", clientId],
    queryFn: () => clientAssetEntity.filter({ client_id: clientId }, "-created_date", 500),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const categoryByFolderId = useMemo(() => {
    const map = {};
    for (const folder of clientFolders) {
      map[folder.id] = resolveClientCategoryFromFolder(folder);
    }
    return map;
  }, [clientFolders]);

  const selectableAssets = useMemo(() => {
    const withLinkState = determineAlreadyLinkedState(
      clientAssets.filter((asset) => !asset.is_archived && categoryByFolderId[asset.folder_id] !== "Invoices & Quotes"),
      currentOrderUrls
    );
    return withLinkState;
  }, [clientAssets, categoryByFolderId, currentOrderUrls]);

  const availableCategories = useMemo(() => {
    const present = new Set(selectableAssets.map((asset) => categoryByFolderId[asset.folder_id] || "General"));
    return ORDER_ASSET_CATEGORIES.filter((category) => category !== "Invoices & Quotes" && present.has(category));
  }, [selectableAssets, categoryByFolderId]);

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return selectableAssets.filter((asset) => {
      if (categoryFilter && (categoryByFolderId[asset.folder_id] || "General") !== categoryFilter) return false;
      if (term && !String(asset.title || "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [selectableAssets, categoryFilter, categoryByFolderId, search]);

  const toggleSelected = (assetId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const allFilteredSelected = filteredAssets.length > 0 && filteredAssets.every((asset) => selectedIds.has(asset.id));
  const toggleSelectAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filteredAssets.forEach((asset) => next.delete(asset.id));
      } else {
        filteredAssets.forEach((asset) => next.add(asset.id));
      }
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const loading = foldersLoading || assetsLoading;

  const handleLinkClick = () => {
    const selected = clientAssets.filter((asset) => selectedIds.has(asset.id));
    onLink(selected, categoryByFolderId);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[92vh] w-full max-w-3xl flex-col rounded-t-3xl border border-border bg-card shadow-2xl sm:h-[85vh] sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Add from client library</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select any of this client's existing files. The same stored file is linked into this order — nothing
              is re-uploaded.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files..."
              className="h-9 w-full rounded-full border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-9 rounded-full border border-border bg-background px-3 text-xs outline-none focus:border-primary/50"
          >
            <option value="">All categories</option>
            {availableCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          {filteredAssets.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {allFilteredSelected ? "Clear selection" : `Select all (${filteredAssets.length})`}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!clientId ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              This order has no linked client yet.
            </p>
          ) : loading ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Loading client library...
            </p>
          ) : filteredAssets.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {selectableAssets.length === 0 ? "This client has no library files yet." : "No files match your search."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filteredAssets.map((asset) => {
                const isSelected = selectedIds.has(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleSelected(asset.id)}
                    className={`relative overflow-hidden rounded-2xl border p-2 text-left transition-all ${
                      isSelected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card">
                      {isSelected && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                    </div>
                    <MediaPreview url={asset.file_url} title={asset.title || "Client file"} className="h-24 w-full rounded-xl" interactive={false} />
                    <p className="mt-2 truncate text-xs font-semibold text-foreground" title={asset.title}>
                      {asset.title || "Client file"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {categoryByFolderId[asset.folder_id] || "General"}
                    </p>
                    {asset.alreadyLinkedToOrder && (
                      <span className="mt-1 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Already on this order
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border p-4">
          <button
            type="button"
            onClick={handleLinkClick}
            disabled={selectedCount === 0}
            className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selectedCount === 0 ? "Select files to link" : `Link ${selectedCount} file${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

