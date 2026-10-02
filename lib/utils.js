import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function readTextFile(path) {
    return new Promise(resolve => {
        try {
            const file = Gio.File.new_for_path(path);
            file.load_bytes_async(null, (file_, res) => {
                try {
                    const bytes = file_.load_bytes_finish(res);
                    resolve(new TextDecoder('utf-8').decode(bytes.toArray()));
                } catch {
                    resolve(null);
                }
            });
        } catch {
            resolve(null);
        }
    });
}

export function readTextFileSync(path) {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS))
        return null;
    try {
        const [ok, content] = GLib.file_get_contents(path);
        if (ok)
            return new TextDecoder('utf-8').decode(content);
    } catch { }
    return null;
}

export function removeSource(sourceId) {
    if (sourceId)
        GLib.Source.remove(sourceId);
    return 0;
}

export function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}
