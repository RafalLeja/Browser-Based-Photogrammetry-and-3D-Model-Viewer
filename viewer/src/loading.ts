// Small helpers for loading: the progress payload and the errors a page can tell apart.
// No three import, so Node can test them.
import type { ViewerEvents } from './types';

/**
 * Builds the "progress" event. `total` is null unless it can be trusted: the server must have
 * sent a size, and `loaded` must not have passed it. A compressed response announces its
 * compressed size, while `loaded` counts the uncompressed bytes, so the bar would pass 100 %.
 */
export function progressPayload(
  url: string,
  loaded: number,
  total: number,
  lengthComputable: boolean,
): ViewerEvents['progress'] {
  const trusted = lengthComputable && total > 0 && loaded <= total;
  return { url, loaded, total: trusted ? total : null };
}

/** True for a cancelled download. `fetch` and the viewer both name that error 'AbortError'. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/** The HTTP status of a failed download, e.g. 404. three's HttpError carries the response. */
export function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

/** The rejection of a load() that a newer load() or dispose() replaced. */
export function abortError(url: string): Error {
  const error = new Error(`[viewer] load("${url}") was cancelled by a newer load() or dispose()`);
  error.name = 'AbortError';
  return error;
}
