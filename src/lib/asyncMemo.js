// A single-flight async memo that does NOT cache rejections.
//
// The tenant-context bug this exists to stop: `let p = null; p ||= run()`
// keeps serving the SAME promise forever — so one transient failure
// (a network blip on the membership query) poisons every later call
// until a full page reload.
//
// Contract:
//   get()   — returns the in-flight promise if one is running (so
//             concurrent callers share one round-trip), otherwise starts
//             a new run. If the run REJECTS, the memo is cleared before
//             the rejection propagates, so the very next get() retries.
//             A fulfilled value stays cached until reset().
//   reset() — drop any cached/in-flight value; the next get() starts fresh.
//   peek()  — current cached value or undefined (no run triggered).
//
// Pure: no imports, safe for `node --test`.

export function createRetryableMemo(run) {
  if (typeof run !== "function") {
    throw new TypeError("createRetryableMemo(run): run must be a function");
  }

  let settledValue; // set only once the promise fulfils
  let hasValue = false;
  let inFlight = null;

  function get() {
    if (hasValue) return Promise.resolve(settledValue);
    if (inFlight) return inFlight;

    // Promise.resolve().then(run) also turns a synchronous throw from
    // `run` into a rejection (handled below), never an escaped exception.
    inFlight = Promise.resolve().then(run).then(
      (value) => {
        settledValue = value;
        hasValue = true;
        inFlight = null;
        return value;
      },
      (error) => {
        // Do NOT cache the rejection — clear first, then propagate.
        inFlight = null;
        hasValue = false;
        settledValue = undefined;
        throw error;
      },
    );
    return inFlight;
  }

  function reset() {
    settledValue = undefined;
    hasValue = false;
    inFlight = null;
  }

  function peek() {
    return hasValue ? settledValue : undefined;
  }

  return { get, reset, peek };
}
