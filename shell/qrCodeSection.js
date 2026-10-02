import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isCancelled} from '../lib/utils.js';

const SHOW_LABEL = 'Show Wi-Fi QR Code';
const HIDE_LABEL = 'Hide Wi-Fi QR Code';

const escapeQr = text => text.replace(/([\\;:,"\/])/g, '\\$1');

/**
 * Collapsible Wi-Fi QR code in the quick settings menu. The image is rendered
 * with the qrencode command into the user's runtime directory.
 */
export class QrCodeSection {
    /**
     * @param {St.BoxLayout} parent - container the menu items are added to
     * @param {CommandRunner} runner - runs qrencode
     * @param {Function} getConfig - returns the current {ssid, password}
     */
    constructor(parent, runner, getConfig) {
        this._runner = runner;
        this._getConfig = getConfig;
        this._shown = false;
        this._lastQrString = null;
        this._qrFile = null;
        this._requestId = 0;

        this._toggleItem = new PopupMenu.PopupMenuItem(SHOW_LABEL);
        this._toggleItem.connect('activate', () => this._toggle());

        this._container = new St.Bin({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: false,
            style_class: 'hotspot-qr-container',
        });
        this._icon = new St.Icon({icon_size: 180, width: 180, height: 180});
        this._container.set_child(this._icon);

        this._separator = new PopupMenu.PopupSeparatorMenuItem();

        for (const actor of [this._toggleItem, this._container, this._separator]) {
            parent.add_child(actor);
            actor.hide();
        }
    }

    get isShown() {
        return this._shown;
    }

    /**
     * @param {boolean} active - whether the hotspot is running
     * @param {boolean} forceRefresh - regenerate even if nothing changed
     */
    sync(active, forceRefresh = false) {
        if (active) {
            this._toggleItem.show();
            if (this._shown)
                this.refresh(forceRefresh);
            return;
        }

        this._requestId++;
        this._shown = false;
        this._toggleItem.label.text = SHOW_LABEL;
        this._toggleItem.hide();
        this._hideImage();
    }

    async refresh(forceRefresh = false) {
        const {ssid, password} = this._getConfig();
        const qrString = `WIFI:S:${escapeQr(ssid)};T:WPA;P:${escapeQr(password)};;`;
        if (!forceRefresh && this._lastQrString === qrString && this._container.visible)
            return;
        this._lastQrString = qrString;

        // A new file name each time makes St.Icon reload the image.
        const file = GLib.build_filenamev([
            GLib.get_user_runtime_dir(),
            `wifi-hotspot-qr-${GLib.get_user_name()}-${Date.now()}.png`,
        ]);
        const requestId = ++this._requestId;

        try {
            const {ok} = await this._runner.run(['qrencode', '-t', 'PNG', '-s', '5', '-o', file], qrString);
            if (!ok)
                throw new Error('qrencode exited with an error');
        } catch (e) {
            this._deleteFile(file);
            if (isCancelled(e))
                return;
            console.warn(`Could not create the Wi-Fi QR code: ${e.message}`);
            if (requestId === this._requestId) {
                this._lastQrString = null;
                this._hideImage();
            }
            return;
        }

        if (requestId !== this._requestId) {
            this._deleteFile(file);
            return;
        }

        this._icon.set_gicon(Gio.FileIcon.new(Gio.File.new_for_path(file)));
        this._deleteFile(this._qrFile);
        this._qrFile = file;
        if (this._shown) {
            this._container.show();
            this._separator.show();
        }
    }

    destroy() {
        this._requestId++;
        this._deleteFile(this._qrFile);
        this._qrFile = null;
    }

    _toggle() {
        this._shown = !this._shown;
        this._toggleItem.label.text = this._shown ? HIDE_LABEL : SHOW_LABEL;
        if (this._shown)
            this.refresh();
        else
            this._hideImage();
    }

    _hideImage() {
        this._container.hide();
        this._separator.hide();
    }

    _deleteFile(path) {
        if (!path)
            return;

        try {
            Gio.File.new_for_path(path).delete(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`Could not remove ${path}: ${e.message}`);
        }
    }
}
