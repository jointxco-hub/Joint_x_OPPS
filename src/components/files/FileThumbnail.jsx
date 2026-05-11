import React from "react";
import MediaPreview from "@/components/common/MediaPreview";

export default function FileThumbnail({ fileUrl, fileType, title, className = "" }) {
  return (
    <MediaPreview
      url={fileUrl}
      title={title || fileType || "File"}
      className={className}
    />
  );
}
