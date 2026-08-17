import { useMemo } from 'react';
import { File, FileImage, FileText } from 'lucide-react';
import { useXosFiles } from '@/lib/useXosData';
import SignedFileLink from '@/components/common/SignedFileLink';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, formatDate, formatFileSize } from './xosUi';

const UNFILED_GROUP = 'Files';

function iconFor(fileType) {
  const type = (fileType || '').toLowerCase();
  if (type.includes('image') || type.includes('png') || type.includes('jpg') || type.includes('jpeg')) return FileImage;
  if (type.includes('pdf') || type.includes('doc')) return FileText;
  return File;
}

export default function XOSFiles({ gate }) {
  const { data, isLoading, error, refetch } = useXosFiles({ hostname: gate.hostname, limit: 50 });

  // Group by the real folder_name returned by the RPC - never invented
  // category labels. Files without a folder fall under a single generic
  // "Files" group rather than several arbitrary buckets.
  const groups = useMemo(() => {
    const files = data || [];
    const byFolder = new Map();
    for (const file of files) {
      const key = file.folder_name || UNFILED_GROUP;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key).push(file);
    }
    return Array.from(byFolder.entries());
  }, [data]);

  return (
    <div className="pb-12">
      <PageHeader title="Files" description="Private files shared with you, opened with short-lived secure links." />

      {isLoading && <ListSkeleton />}
      {!isLoading && error && <ErrorState message={error.message} onRetry={refetch} />}
      {!isLoading && !error && (data || []).length === 0 && (
        <EmptyState title="No files yet." description="Files shared with you will appear here." />
      )}

      {!isLoading && !error && groups.length > 0 && (
        <div className="space-y-6 px-4 py-4 sm:px-6">
          {groups.map(([folderName, files]) => (
            <section key={folderName}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{folderName}</h2>
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
                {files.map((file) => {
                  const Icon = iconFor(file.file_type);
                  const size = formatFileSize(file.file_size);
                  return (
                    <div key={file.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-900">{file.file_name || 'File'}</p>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {[file.file_type, size, formatDate(file.created_at)].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </div>
                      <SignedFileLink
                        url={file.file_ref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                      >
                        Open
                      </SignedFileLink>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
