import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {loadOrCreateConfig} from '../lib/config.js';
import {isCancelled, removeSource} from '../lib/utils.js';
import {ClientsSection} from './clientsSection.js';
import {CommandRunner} from './commandRunner.js';
import {WifiHandoverMonitor} from './handoverMonitor.js';
import {HotspotService} from './hotspotService.js';
import {QrCodeSection} from './qrCodeSection.js';

const ICON_NAME = 'network-wireless-hotspot-symbolic';
const POLL_SECONDS = 3;
const STATUS_ACTIVE = 'Active • Manage connected clients';
const STATUS_INACTIVE = 'Inactive • Manage connected clients';

export const HotspotToggle = GObject.registerClass(
class HotspotToggle extends QuickSettings.QuickMenuToggle {
    constructor(extension) {
        super({
            title: 'Hotspot',
            iconName: ICON_NAME,
            toggleMode: true,
        });

        this._extension = extension;
        this._transitioning = false;
        this._runner = new CommandRunner();
        this._service = new HotspotService(this._runner);
        this._config = {ssid: 'hotspot', password: '', band: 'bg'};

        this._buildMenu();
        this._reloadConfig();
        this._updateLabels();

        this.connect('clicked', () => this._handleToggle(this.checked));
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._onMenuOpened();
        });

        this._settings = extension.getSettings();
        this._settingsChangedId = this._settings.connect('changed', () => this._onSettingsChanged());

        this._handover = new WifiHandoverMonitor(this._service, this._runner, {
            canHandover: () => this.checked && !this._transitioning,
            onStatus: (subtitle, header) => this._showBusy(subtitle, header),
            onFinished: () => this._finishHandover(),
        });

        this._syncServiceState();
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._syncServiceState();
            if (this.menu.isOpen && this.checked)
                this._clients.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        this._pollId = removeSource(this._pollId);
        this._clients.destroy();
        this._clients = null;
        this._handover.destroy();
        this._handover = null;
        this._runner.destroy();
        this._runner = null;
        this._settings.disconnect(this._settingsChangedId);
        this._settings = null;
        this._qr.destroy();
        this._qr = null;
        super.destroy();
    }

    _buildMenu() {
        const scrollItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'hotspot-scrollview',
        });
        scrollItem.y_expand = true;

        const scrollView = new St.ScrollView({
            style_class: 'vfade hotspot-scrollview',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        const content = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});

        this._qr = new QrCodeSection(content, this._runner, () => this._reloadConfig());
        this._clients = new ClientsSection(content, {
            runner: this._runner,
            menu: this.menu,
            isActive: () => this.checked,
        });

        content.add_child(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupMenuItem('Extension Settings');
        settingsItem.connect('activate', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        content.add_child(settingsItem);

        scrollView.set_child(content);
        scrollItem.add_child(scrollView);
        this.menu.addMenuItem(scrollItem);
    }

    _reloadConfig() {
        this._config = loadOrCreateConfig();
        return this._config;
    }

    async _onMenuOpened() {
        this._reloadConfig();
        await this._updateLabels();
        this._syncSections(true);
    }

    async _onSettingsChanged() {
        this._reloadConfig();
        await this._updateLabels();
        if (this.menu.isOpen && this.checked && this._qr.isShown)
            this._qr.refresh(true);
    }

    _syncSections(forceQrRefresh = false) {
        this._qr.sync(this.checked, forceQrRefresh);
        this._clients.sync(this.checked);
    }

    async _readBandLabel() {
        const activeMode = this.checked ? await this._service.readActiveMode() : '';
        const mode = activeMode || this._config.band;

        if (mode.includes('5G') || mode === 'a')
            return '5GHz';
        if (mode.includes('6G'))
            return '6GHz';
        return '2.4GHz';
    }

    async _updateLabels() {
        const band = await this._readBandLabel();
        if (!this._transitioning)
            this.subtitle = this.checked ? band : 'Off';

        let status = this.checked ? STATUS_ACTIVE : STATUS_INACTIVE;
        if (this._transitioning)
            status = this.subtitle || 'Transitioning...';
        this.menu.setHeader(ICON_NAME, `Hotspot (${band})`, status);
    }

    async _showBusy(subtitle, header = null) {
        this.subtitle = subtitle;
        if (header !== null)
            this.menu.setHeader(ICON_NAME, `Hotspot (${await this._readBandLabel()})`, header);
    }

    async _syncServiceState() {
        let active = false;
        try {
            active = await this._service.isActive();
        } catch (e) {
            if (isCancelled(e))
                return false;
        }

        if (this.checked !== active) {
            this.checked = active;
            if (!this._transitioning)
                await this._updateLabels();
        }
        return true;
    }

    async _handleToggle(activate) {
        this._transitioning = true;
        this._handover.abort();
        await this._showBusy(
            activate ? 'Starting...' : 'Stopping...',
            activate ? 'Starting hotspot...' : 'Stopping hotspot...');

        try {
            await (activate ? this._service.start() : this._service.stop());
        } catch (e) {
            if (isCancelled(e))
                return;
            console.warn(`Could not ${activate ? 'start' : 'stop'} the hotspot service: ${e.message}`);
        }

        this._transitioning = false;
        if (!await this._syncServiceState())
            return;

        await this._updateLabels();
        if (activate && !this.checked) {
            const message = await this._service.readLastError();
            if (message)
                Main.notify('Wi-Fi Hotspot Router', message);
        }
        if (this.menu.isOpen)
            this._syncSections();
    }

    async _finishHandover() {
        if (!await this._syncServiceState())
            return;

        await this._updateLabels();
        if (this.menu.isOpen && this.checked)
            this._syncSections();
    }
});
