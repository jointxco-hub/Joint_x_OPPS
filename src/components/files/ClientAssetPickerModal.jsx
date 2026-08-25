import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import MediaPreview from "@/components/common/MediaPreview";
import { ORDER_ASSET_CATEGORIES } from "@/lib/orderAssetFolders";
import { resolveClientCategoryFromFolder, determineAlreadyLinkedState } from "@/lib/clientAssetOrderLink";

// Shared client_assets browser/picker - the canonical client file library
// (client_id-scoped, tenant-scoped, already correctly RLS-isolated - see
// client_assets' own "Staff manage" RESTRICTIVE is_opps_staff() policy).
// Originally built as OrderFilesTab's inline ClientLibraryPickerModal for
// bulk-linking files into an order; extracted so the artwork-linking flow
// (Product Composition) can reuse the exact same browsing/search/category
// UI in single-select mode instead of re-implementing it.
//
// selectionMode "multi" (default) preserves the original order-files
// behavior exactly: multi-select, "Link N files" action, "Already on this
// order" badges via currentOrderUrls. selectionMode "single" is for
// artwork linking: one asset only, confirms immediately on pick, no
// order-linked-state styling, and (when showApprovalBadge is set) surfaces
// each asset's approval_status and sorts approved assets first.
//
// Phase 1B - Upload New (Order Line Coherence). Reuses the exact canonical
// upload primitive already used by OrderDrawer.jsx's uploadFile and
// FileManager.jsx (dataClient.integrations.Core.UploadFile -> a real
// ClientAsset row) - never a second upload implementation. Gated by
// uploadCategory: the consumer must explicitly supply which category a new
// upload belongs in (e.g. "Artwork" for the artwork-linking flow, "Mockups"
// for the line-thumbnail flow) - if it's not supplied, the Upload New
// control simply does not render, rather than guessing a category. The
// destination folder_id is resolved from the client's ALREADY-fetched
// folders for that category (never a new get-or-create-folder RPC, which
// would need a migration this phase doesn't need) - if no such folder
// exists yet for this client, the upload lands uncategorized (folder_id
// null), exactly like FileManager's own upload-to-current-folder fallback,
// rather than inventing folder auto-provisioning here.
export default function ClientAssetPickerModal({
  clientId,
  onClose,
  onConfirm,
  currentOrderUrls,
  selectionMode = "multi",
  defaultCategory = "",
  uploadCategory = "",
  showApprovalBadge = false,
  title = "Add from client library",
  description = "Select any of this client's existing files. The same stored file is linked - nothing is re-uploaded.",
  confirmVerb = "Link",
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(defaultCategory);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

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
    const nonInvoiceAssets = clientAssets.filter(
      (asset) => !asset.is_archived && categoryByFolderId[asset.folder_id] !== "Invoices & Quotes"
    );
    const withLinkState = currentOrderUrls
      ? determineAlreadyLinkedState(nonInvoiceAssets, currentOrderUrls)
      : nonInvoiceAssets;
    if (!showApprovalBadge) return withLinkState;
    return [...withLinkState].sort((a, b) => {
      const aApproved = a.approval_status === "approved" ? 0 : 1;
      const bApproved = b.approval_status === "approved" ? 0 : 1;
      return aApproved - bApproved;
    });
  }, [clientAssets, categoryByFolderId, currentOrderUrls, showApprovalBadge]);

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
    if (selectionMode === "single") {
      const asset = clientAssets.find((item) => item.id === assetId);
      if (asset) onConfirm([asset], categoryByFolderId);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  // Upload New: choose file -> UploadFile -> canonical ClientAsset,
  // reusing an existing row by (client_id, file_url) if one already exists
  // rather than ever creating a second row for the same stored file (the
  // same create-or-reuse pattern OrderDrawerShared.jsx's
  // mirrorOrderFileToClientAssetFolder already uses). folder_id is resolved
  // from the client's own already-fetched folders for uploadCategory - a
  // real folder if one exists, otherwise null (uncategorized), never a
  // synthetic/order-only reference.
  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      if (!clientId) throw new Error("No linked client yet - cannot upload.");
      if (!uploadCategory) throw new Error("Upload category not configured for this picker.");

      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      if (!file_url) throw new Error("Upload failed - no file was stored.");

      const existing = await clientAssetEntity.filter({ client_id: clientId, file_url }, undefined, 1);
      const existingAsset = Array.isArray(existing) ? existing[0] : null;
      if (existingAsset) return existingAsset;

      const targetFolder = clientFolders.find((folder) => resolveClientCategoryFromFolder(folder) === uploadCategory);
      return clientAssetEntity.create({
        client_id: clientId,
        title: file.name,
        file_url,
        folder_id: targetFolder?.id ?? null,
      });
    },
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: ["clientLibraryAssets", clientId] });
      queryClient.invalidateQueries({ queryKey: ["clientLibraryFolders", clientId] });
      if (selectionMode === "single") {
        // Auto-select and continue through the exact same confirm path a
        // click on an existing tile would take - the caller never knows
        // whether the asset was picked or just uploaded.
        onConfirm([asset], categoryByFolderId);
      } else {
        setSelectedIds((current) => new Set(current).add(asset.id));
        toast.success("File uploaded");
      }
    },
    onError: (error) => toast.error(error?.message || "Upload failed"),
  });

  const handleFileChosen = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadMutation.mutate(file);
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

  const handleConfirmClick = () => {
    const selected = clientAssets.filter((asset) => selectedIds.has(asset.id));
    onConfirm(selected, categoryByFolderId);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[92vh] w-full max-w-3xl flex-col rounded-t-3xl border border-border bg-card shadow-2xl sm:h-[85vh] sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
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
          {selectionMode === "multi" && filteredAssets.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {allFilteredSelected ? "Clear selection" : `Select all (${filteredAssets.length})`}
            </button>
          )}
          {uploadCategory && Boolean(clientId) && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploadMutation.isPending ? "Uploading..." : "Upload new"}
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!clientId ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No linked client yet.
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
                const isSelected = selectionMode === "multi" && selectedIds.has(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleSelected(asset.id)}
                    className={`relative overflow-hidden rounded-2xl border p-2 text-left transition-all ${
                      isSelected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    {selectionMode === "multi" && (
                      <div className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card">
                        {isSelected && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                      </div>
                    )}
                    <MediaPreview url={asset.file_url} title={asset.title || "Client file"} className="h-24 w-full rounded-xl" interactive={false} />
                    <p className="mt-2 truncate text-xs font-semibold text-foreground" title={asset.title}>
                      {asset.title || "Client file"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {categoryByFolderId[asset.folder_id] || "General"}
                    </p>
                    {showApprovalBadge && (
                      <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        asset.approval_status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        {asset.approval_status === "approved" ? "Approved" : (asset.approval_status || "pending")}
                      </span>
                    )}
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

        {selectionMode === "multi" && (
          <div className="border-t border-border p-4">
            <button
              type="button"
              onClick={handleConfirmClick}
              disabled={selectedCount === 0}
              className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {selectedCount === 0 ? "Select files to link" : `${confirmVerb} ${selectedCount} file${selectedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
