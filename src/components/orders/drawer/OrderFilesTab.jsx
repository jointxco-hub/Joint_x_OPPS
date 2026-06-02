import { useState } from "react";
import {
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  FolderPlus,
  MoveRight,
  Paperclip,
  Pencil,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import MediaPreview from "@/components/common/MediaPreview";
import { INVOICE_FOLDER_ID, normalizeOrderFileFolders } from "./OrderDrawerShared";

export default function OrderFilesTab({ order, onUpdate, uploadFile, uploading, onPrint }) {
  const metadata = normalizeOrderFileFolders(order.order_file_folders);
  const [openFolderId, setOpenFolderId] = useState("");
  const fileUrls = Array.isArray(order.file_urls) ? order.file_urls.filter(Boolean) : [];
  const visibleUrls = Array.isArray(order.portal_visible_file_urls) ? order.portal_visible_file_urls : [];
  const invoices = Array.isArray(order.invoice_files) ? order.invoice_files : [];
  const folders = metadata.folders;
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
  const currentFiles = openFolderId
    ? fileEntries.filter((entry) => entry.folderId === openFolderId)
    : [];
  const isInvoiceFolder = openFolderId === INVOICE_FOLDER_ID;

  const saveMetadata = (next) => onUpdate(order.id, { order_file_folders: next });

  const createFolder = () => {
    const name = window.prompt("Folder name");
    const clean = String(name || "").trim();
    if (!clean) return;
    const id = `folder-${Date.now().toString(36)}`;
    saveMetadata({ ...metadata, folders: [...folders, { id, name: clean }] });
    setOpenFolderId(id);
  };

  const renameFolder = (folderId) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const name = window.prompt("Rename folder", folder.name);
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
  };

  const renameFile = (entry) => {
    const name = window.prompt("Rename file label", displayFileName(entry));
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
    const folderName = window.prompt(
      `Copy link to folder:\n${targetFolders.map((folder) => folder.name).join(", ")}`,
      targetFolders[0]?.name || ""
    );
    const target = targetFolders.find((folder) => folder.name.toLowerCase() === String(folderName || "").trim().toLowerCase());
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
    onUpdate(order.id, {
      portal_visible_file_urls: checked
        ? Array.from(new Set([...visibleUrls, url]))
        : visibleUrls.filter((item) => item !== url),
    });
  };

  const pasteFileLink = (folderId = openFolderId) => {
    const url = String(window.prompt("Paste file URL") || "").trim();
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
    onUpdate(order.id, {
      file_urls: nextUrls,
      order_file_folders: { ...metadata, fileFolders: nextFolders, fileCopies: nextCopies },
    });
  };

  const copyFileLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("File link copied");
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
    onUpdate(order.id, {
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

  const invoiceUrl = (invoice) => invoice?.file_url || invoice?.url || invoice?.invoice_url || "";
  const invoiceTitle = (invoice, index) => invoice?.invoice_number || invoice?.file_name || invoice?.name || `Invoice ${index + 1}`;
  const displayFileName = (entryOrUrl) => {
    const entry = typeof entryOrUrl === "string" ? { id: `file:${entryOrUrl}`, url: entryOrUrl } : entryOrUrl;
    const override = metadata.fileLabels?.[entry.id] || entry.label;
    if (override) return override;
    try {
      const pathname = new URL(entry.url).pathname;
      return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "File");
    } catch {
      return String(entry.url || "File").split("/").filter(Boolean).pop() || "File";
    }
  };

  const FileCard = ({ entry, index }) => (
    <div className="rounded-2xl border border-border bg-card p-2">
      <MediaPreview url={entry.url} title={displayFileName(entry) || `Order file ${index + 1}`} />
      <div className="mt-2 space-y-2">
        <div className="flex items-start justify-between gap-2 px-1">
          <p className="truncate text-xs font-semibold text-foreground" title={displayFileName(entry)}>
            {displayFileName(entry)}
          </p>
          {entry.isCopy && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">linked</span>}
        </div>
        {entry.isCopy && (
          <p className="px-1 text-[11px] leading-4 text-muted-foreground">Same storage file, linked into this folder.</p>
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
          <span className="font-medium text-foreground">Client can see</span>
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
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600"
          >
            Copy to...
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
          <MediaPreview url={url} title={invoiceTitle(invoice, index)} />
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
          <p className="text-xs text-muted-foreground">Print mockups/reference sheets for production.</p>
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

      <div className="grid grid-cols-2 gap-2">
        <label className="block cursor-pointer">
          <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-4 transition-all hover:border-primary/40">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Upload files"}</span>
          </div>
          <input type="file" className="hidden" multiple onChange={uploadFile} disabled={uploading} />
        </label>
        <button
          type="button"
          onClick={() => pasteFileLink(openFolderId)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm font-medium text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground"
        >
          <Copy className="h-4 w-4" />
          Paste file link
        </button>
      </div>

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

          <div className="grid grid-cols-2 gap-2">
            {folders.map((folder) => {
              const count = fileEntries.filter((entry) => entry.folderId === folder.id).length;
              return (
                <div
                  key={folder.id}
                  className="rounded-2xl border border-border bg-secondary/30 p-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                >
                  <button type="button" onClick={() => setOpenFolderId(folder.id)} className="block w-full text-left">
                    <FolderOpen className="mb-3 h-5 w-5 text-primary" />
                    <p className="truncate text-sm font-semibold text-foreground">{folder.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{count} item{count === 1 ? "" : "s"}</p>
                  </button>
                  <div className="mt-3 grid grid-cols-2 gap-1">
                    <button type="button" onClick={() => renameFolder(folder.id)} className="rounded-lg bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">Rename</button>
                    <button type="button" onClick={() => deleteFolder(folder.id)} className="rounded-lg bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:text-red-600">Delete</button>
                  </div>
                </div>
              );
            })}
            {invoices.length > 0 && (
              <button
                type="button"
                onClick={() => setOpenFolderId(INVOICE_FOLDER_ID)}
                className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left transition-all hover:border-amber-300"
              >
                <FileText className="mb-3 h-5 w-5 text-amber-700" />
                <p className="truncate text-sm font-semibold text-amber-950">Invoices & Quotes</p>
                <p className="mt-1 text-xs text-amber-800">{invoices.length} item{invoices.length === 1 ? "" : "s"}</p>
              </button>
            )}
          </div>

          {uncategorizedFiles.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All Files</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {uncategorizedFiles.map((entry, index) => <FileCard key={entry.id} entry={entry} index={index} />)}
              </div>
            </div>
          )}
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
              <p className="text-sm font-semibold text-foreground">{isInvoiceFolder ? "Invoices & Quotes" : currentFolder?.name || "Folder"}</p>
              <p className="text-xs text-muted-foreground">
                {isInvoiceFolder ? invoices.length : currentFiles.length} item{(isInvoiceFolder ? invoices.length : currentFiles.length) === 1 ? "" : "s"}
              </p>
            </div>
            {!isInvoiceFolder && currentFolder && (
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
    </div>
  );
}
