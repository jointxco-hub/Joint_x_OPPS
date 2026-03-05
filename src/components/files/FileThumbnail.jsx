import React from "react";
import { FileText, File, Download, ExternalLink } from "lucide-react";

export default function FileThumbnail({ fileUrl, fileType, title, className = "" }) {
  const getFileExtension = () => {
    if (fileType) return fileType.toLowerCase();
    if (!fileUrl) return null;
    const match = fileUrl.match(/\.([^.?]+)(\?|$)/);
    return match ? match[1].toLowerCase() : null;
  };

  const ext = getFileExtension();
  const isImage = ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';
  const isDoc = ext && ['doc', 'docx'].includes(ext);
  const isExcel = ext && ['xls', 'xlsx'].includes(ext);
  const isZip = ext && ['zip', 'rar', '7z'].includes(ext);

  const handleOpen = (e) => {
    e.preventDefault();
    window.open(fileUrl, '_blank');
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = title || 'file';
    a.target = '_blank';
    a.click();
  };

  return (
    <div
      className={`relative rounded overflow-hidden bg-slate-100 cursor-pointer group ${className}`}
      onClick={handleOpen}
      title="Click to view"
    >
      {isImage ? (
        <img
          src={fileUrl}
          alt={title}
          className="w-full h-full object-cover"
        />
      ) : isPdf ? (
        <div className="flex flex-col items-center justify-center w-full h-full bg-red-50">
          <FileText className="w-8 h-8 text-red-500 mb-1" />
          <span className="text-xs font-medium text-red-700">PDF</span>
        </div>
      ) : isDoc ? (
        <div className="flex flex-col items-center justify-center w-full h-full bg-blue-50">
          <FileText className="w-8 h-8 text-blue-500 mb-1" />
          <span className="text-xs font-medium text-blue-700">DOCX</span>
        </div>
      ) : isExcel ? (
        <div className="flex flex-col items-center justify-center w-full h-full bg-green-50">
          <FileText className="w-8 h-8 text-green-500 mb-1" />
          <span className="text-xs font-medium text-green-700">XLSX</span>
        </div>
      ) : isZip ? (
        <div className="flex flex-col items-center justify-center w-full h-full bg-purple-50">
          <File className="w-8 h-8 text-purple-500 mb-1" />
          <span className="text-xs font-medium text-purple-700">ZIP</span>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center w-full h-full">
          <File className="w-8 h-8 text-slate-400 mb-1" />
          <span className="text-xs font-medium text-slate-600 uppercase">{ext || 'FILE'}</span>
        </div>
      )}

      {/* Hover overlay with actions */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
        <button
          onClick={handleOpen}
          className="p-2 bg-white rounded-full text-slate-800 hover:bg-slate-100"
          title="Open"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
        <button
          onClick={handleDownload}
          className="p-2 bg-white rounded-full text-slate-800 hover:bg-slate-100"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}