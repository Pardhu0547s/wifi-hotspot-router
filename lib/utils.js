import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Read a text file. Returns null when the file is missing or unreadable, which
 * is a normal state for the optional runtime files written by the service.
 *
 * @param {string} path - absolute file path
 * @returns {string|null}
 */
export function readTextFile(path) {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        return ok ? new TextDecoder('utf-8').decode(contents) : null;
    } catch {
        return null;
    }
}

/**
 * Remove a main loop source if it is set and return 0 so callers can reset
 * their stored id in one statement.
 *
 * @param {number} sourceId - id returned by GLib.timeout_add() or similar
 * @returns {number}
 */
export function removeSource(sourceId) {
    if (sourceId)
        GLib.Source.remove(sourceId);
    return 0;
}

/**
 * @param {Error} error - error from an async Gio operation
 * @returns {boolean} true if the operation was cancelled
 */
export function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}
