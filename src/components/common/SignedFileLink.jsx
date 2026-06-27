import { useSignedFileUrl } from "@/lib/privateFiles";

export default function SignedFileLink({
  url,
  children,
  className = "",
  loadingLabel = "Preparing secure link...",
  errorLabel = "File access unavailable",
  ...props
}) {
  const { url: signedUrl, loading, error, isPrivate } = useSignedFileUrl(url);
  const href = signedUrl || (isPrivate ? "" : url);
  const disabled = !href || loading || Boolean(error);

  return (
    <a
      {...props}
      href={href || undefined}
      aria-disabled={disabled}
      className={`${className} ${disabled ? "pointer-events-none opacity-60" : ""}`}
      title={error ? errorLabel : loading ? loadingLabel : props.title}
    >
      {error ? errorLabel : loading ? loadingLabel : children}
    </a>
  );
}
