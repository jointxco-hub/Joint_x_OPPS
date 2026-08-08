// Given the reference currently selected for each printable image slot and a
// map of the last-known load status per slot, decides whether a print view
// can proceed. A slot only counts as settled once its tracked status entry
// matches its CURRENT raw reference - a stale entry left over from a removed
// slot or a since-changed reference never blocks print, and a changed
// reference never inherits an old "ready" status from what used to be there.
export function computeImageReadiness(targets, statusByKey) {
  const isSettled = ({ key, ref }) => {
    const entry = statusByKey[key];
    return Boolean(entry) && entry.ref === ref && (entry.status === "ready" || entry.status === "error");
  };
  const isFailed = ({ key, ref }) => {
    const entry = statusByKey[key];
    return Boolean(entry) && entry.ref === ref && entry.status === "error";
  };

  const pendingCount = targets.filter((target) => !isSettled(target)).length;
  const failedCount = targets.filter(isFailed).length;

  return { pendingCount, failedCount, ready: pendingCount === 0 };
}
