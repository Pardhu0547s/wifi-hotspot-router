import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readTextFile} from '../lib/utils.js';

const ACTIVE_MODE_FILE = '/run/wifi-hotspot/active-mode';
const LAST_ERROR_FILE = '/run/wifi-hotspot/last-error';

export class HotspotService {
    constructor(runner) {
        this._runner = runner;
        this._unitName = `wifi-hotspot@${GLib.get_user_name()}.service`;
    }

    start() {
        this._clearLastError();
        return this._runner.run(['systemctl', 'start', this._unitName]);
    }

    stop() {
        return this._runner.run(['systemctl', 'stop', this._unitName]);
    }

    async readActiveMode() {
        return (await readTextFile(ACTIVE_MODE_FILE))?.trim() ?? '';
    }

    async readLastError() {
        return (await readTextFile(LAST_ERROR_FILE))?.trim() ?? '';
    }

    isActive() {
        return new Promise((resolve, reject) => {
            Gio.DBus.system.call(
                'org.freedesktop.systemd1',
                '/org/freedesktop/systemd1',
                'org.freedesktop.systemd1.Manager',
                'ListUnitsByNames',
                new GLib.Variant('(as)', [[this._unitName]]),
                new GLib.VariantType('(a(ssssssouso))'),
                Gio.DBusCallFlags.NONE,
                -1,
                this._runner.cancellable,
                (connection, result) => {
                    try {
                        const [units] = connection.call_finish(result).deepUnpack();
                        const state = units[0]?.[3];
                        resolve(state === 'active' || state === 'activating');
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    _clearLastError() {
        try {
            Gio.File.new_for_path(LAST_ERROR_FILE).delete(null);
        } catch {
        }
    }
}
