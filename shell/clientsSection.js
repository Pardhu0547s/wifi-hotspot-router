import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isCancelled} from '../lib/utils.js';

const HELPER_COMMAND = ['pkexec', '--disable-internal-agent', '/usr/local/bin/manage_hotspot_clients'];

function parseStatus(output) {
    const [connectedText = '', blockedText = ''] = output.split('===BLOCKED===');

    const parseDevices = text => text
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
            const [mac, name = mac] = line.split('|');
            return {mac, name};
        });

    return {
        connected: parseDevices(connectedText.replace('===CONNECTED===', '')),
        blocked: parseDevices(blockedText),
    };
}

class DeviceList {
    constructor(parent, noun, onExpand) {
        this._noun = noun;
        this._onExpand = onExpand;
        this._expanded = false;
        this._count = 0;

        this._toggleItem = new PopupMenu.PopupMenuItem(`Show ${noun} Devices`);
        this._toggleSignalId = this._toggleItem.connect('activate', () => this._toggle());
        this._section = new PopupMenu.PopupMenuSection();

        parent.add_child(this._toggleItem);
        parent.add_child(this._section.actor);
        this._toggleItem.hide();
        this._section.actor.hide();
    }

    destroy() {
        if (this._toggleItem) {
            if (this._toggleSignalId) {
                this._toggleItem.disconnect(this._toggleSignalId);
                this._toggleSignalId = 0;
            }
            this._toggleItem.destroy();
            this._toggleItem = null;
        }
        if (this._section) {
            this._section.destroy();
            this._section = null;
        }
    }

    show() {
        this._toggleItem.show();
        this._section.actor.visible = this._expanded;
    }

    reset() {
        this._expanded = false;
        this.clear();
        this._toggleItem.hide();
        this._section.actor.hide();
    }

    clear() {
        this._count = 0;
        this._section.removeAll();
        this._updateLabel();
    }

    setRows(rows, emptyText) {
        this._section.removeAll();
        if (rows.length === 0)
            this._section.addMenuItem(new PopupMenu.PopupMenuItem(emptyText, {reactive: false}));
        for (const row of rows)
            this._section.addMenuItem(row);

        this._count = rows.length;
        this._updateLabel();
    }

    _toggle() {
        this._expanded = !this._expanded;
        this._updateLabel();
        this._section.actor.visible = this._expanded;
        if (this._expanded)
            this._onExpand();
    }

    _updateLabel() {
        const count = this._count > 0 ? ` (${this._count})` : '';
        const verb = this._expanded ? 'Hide' : 'Show';
        this._toggleItem.label.text = `${verb} ${this._noun} Devices${count}`;
    }
}

export class ClientsSection {
    constructor(parent, {runner, menu, isActive}) {
        this._runner = runner;
        this._menu = menu;
        this._isActive = isActive;
        this._username = GLib.get_user_name();
        this._lastOutput = null;

        this._connected = new DeviceList(parent, 'Connected', () => this.refresh());
        this._blocked = new DeviceList(parent, 'Blocked', () => this.refresh());
    }

    destroy() {
        if (this._connected) {
            this._connected.destroy();
            this._connected = null;
        }
        if (this._blocked) {
            this._blocked.destroy();
            this._blocked = null;
        }
    }

    sync(active) {
        if (!active) {
            this._lastOutput = null;
            this._connected.reset();
            this._blocked.reset();
            return;
        }

        this._connected.show();
        this._blocked.show();
        this.refresh();
    }

    async refresh() {
        if (!this._isActive()) {
            this._lastOutput = null;
            this._connected.clear();
            this._blocked.clear();
            return;
        }

        let result;
        try {
            result = await this._runner.run([...HELPER_COMMAND, 'status', '', this._username]);
        } catch {
            return;
        }

        if (!this._menu.isOpen || !result.ok || !result.stdout)
            return;

        const output = result.stdout.trim();
        if (output === this._lastOutput)
            return;
        this._lastOutput = output;

        const {connected, blocked} = parseStatus(output);
        this._connected.setRows(
            connected.map(({mac, name}) => this._createRow(name, 'Block', ['block', mac, this._username, name])),
            'No devices connected');
        this._blocked.setRows(
            blocked.map(({mac, name}) => this._createRow(name, 'Unblock', ['unblock', mac, this._username])),
            'No devices blocked');
    }

    _createRow(name, buttonText, helperArgs) {
        const item = new PopupMenu.PopupBaseMenuItem({activate: false});
        item.add_child(new St.Label({
            text: name,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'hotspot-device-title',
        }));

        const button = new St.Button({
            style_class: 'button hotspot-action-btn',
            child: new St.Label({text: buttonText, style_class: 'hotspot-action-btn-label'}),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', () => this._runHelper(helperArgs));
        item.add_child(button);
        return item;
    }

    async _runHelper(helperArgs) {
        this._lastOutput = null;
        try {
            await this._runner.run([...HELPER_COMMAND, ...helperArgs]);
        } catch (e) {
            if (isCancelled(e))
                return;
            console.warn(`Could not run the hotspot helper: ${e.message}`);
        }
        this.refresh();
    }
}
