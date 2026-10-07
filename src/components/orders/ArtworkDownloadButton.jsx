import { useState } from "react";
import { toast } from "sonner";
import { getSignedFileUrl } from "@/lib/privateFiles";

export default function ArtworkDownloadButton({ filePath, fileName = "Artwork", className = "" }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!filePath || downloading) return;
    setDownloading(true);
    let objectUrl;
    try {
      const url = await getSignedFileUrl(filePath);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not download artwork");
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName.replace(/[\\/]/g, "-");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Allow mobile browsers to start consuming the blob before revoking it.
      const completedUrl = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(completedUrl), 60_000);
      objectUrl = null;
    } catch {
      toast.error("Could not download artwork. Check file access and try again.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloading(false);
    }
  };

  return (
    <button type="button" onClick={download} disabled={!filePath || downloading}
      className={className} aria-label={`Download ${fileName}`}>
      {downloading ? "Downloading…" : "Download artwork"}
    </button>
  );
}
