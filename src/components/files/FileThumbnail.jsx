import React from "react";
import { FileText, Image as ImageIcon, File } from "lucide-react";

export default function FileThumbnail({ fileUrl, fileType, title, className = "" }) {
  const getFileExtension = () => {
    if (fileType) return fileType.toLowerCase();
    if (!fileUrl) return null;
    const match = fileUrl.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : null;
  };

  const ext = getFileExtension();
  const isImage = ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';
  const isDoc = ext && ['doc', 'docx'].includes(ext);
  const isExcel = ext && ['xls', 'xlsx'].includes(ext);
  const isZip = ext && ['zip', 'rar', '7z'].includes(ext);

  return (
    <div className={`relative rounded overflow-hidden bg-slate-100 ${className}`}>
      {isImage ? (
        <img 
          src={fileUrl} 
          alt={title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.parentElement.innerHTML = '<div class="flex items-center justify-center w-full h-full"><svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></div>';
          }}
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
    </div>
  );
}