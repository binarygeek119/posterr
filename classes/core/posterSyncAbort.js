/** Thrown when the user aborts a full poster sync; caught inside GetOnDemand to return partial cards. */
class PosterSyncAbortedError extends Error {
  constructor() {
    super("Poster sync aborted by user");
    this.name = "PosterSyncAbortedError";
    this.code = "POSTERR_POSTER_SYNC_ABORTED";
  }
}

/**
 * @param {object} opts - GetOnDemand options
 * @param {boolean} posterSyncFull
 * @param {object|null} syncProgress - posterSyncProgressState slice on `sp`
 */
function checkPosterSyncAborted(opts, posterSyncFull, syncProgress) {
  if (
    !posterSyncFull ||
    typeof opts.posterSyncAbortCheck !== "function" ||
    !opts.posterSyncAbortCheck()
  ) {
    return;
  }
  if (syncProgress) {
    syncProgress.label = "Sync aborted — saving partial results…";
  }
  const n =
    syncProgress && syncProgress.processed != null
      ? syncProgress.processed
      : 0;
  console.log(
    new Date().toLocaleString() +
      " [poster sync] aborted by user — " +
      n +
      " item(s) cached so far"
  );
  throw new PosterSyncAbortedError();
}

module.exports = { PosterSyncAbortedError, checkPosterSyncAborted };
