import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

const HotspotRouterToggle = GObject.registerClass(
    class HotspotRouterToggle extends QuickSettings.QuickMenuToggle {
        _init(extension) {
            this._extension = extension;
            this._timeoutId = 0;
            this._clientCount = 0;
            this._idleSeconds = 0;
            this._inhibitCookie = 0;
            this._inhibitPending = false;

            super._init({
                title: 'Hotspot',
                iconName: 'network-wireless-hotspot-symbolic',
                toggleMode: true,
            });

            // Read band AFTER super._init() so this.checked is available
            this._bandLabel = this._readBand();
            this.title = 'Hotspot';
            this.subtitle = this.checked ? this._bandLabel : 'Off';

            this.menu.setHeader('network-wireless-hotspot-symbolic', `Hotspot (${this._bandLabel})`, 'Manage connected clients');

            // Create a wrapper item for the scroll view
            this._scrollViewItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            this._scrollViewItem.set_style('padding: 0; margin: 0;');
            this._scrollViewItem.y_expand = true;
            
            this._scrollView = new St.ScrollView({
                style_class: 'vfade',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true,
            });

            this._scrollContent = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true
            });

            // Set a fixed max-height on the scroll view to prevent menu overflow
            // Do NOT use notify::height — it causes relayout loops and jitter
            this._scrollView.set_style('max-height: 400px;');

            // QR Code display container (inside the scroll view)
            this._qrCodeContainer = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_expand: false,
                style: 'padding: 12px 0;',
            });
            this._qrCodeIcon = new St.Icon({
                icon_size: 180,
                width: 180,
                height: 180,
            });
            this._qrCodeContainer.set_child(this._qrCodeIcon);
            this._scrollContent.add_child(this._qrCodeContainer);
            this._qrCodeContainer.hide();

            let qrSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this._scrollContent.add_child(qrSeparator);
            
            // Store reference to hide/show separator with QR code — hide initially
            this._qrSeparator = qrSeparator;
            this._qrSeparator.hide();

            // Connected clients section
            this._connectedSection = new PopupMenu.PopupMenuSection();
            this._scrollContent.add_child(this._connectedSection.actor);

            this._scrollContent.add_child(new PopupMenu.PopupSeparatorMenuItem());

            // Blocked clients section
            this._blockedSection = new PopupMenu.PopupMenuSection();
            this._scrollContent.add_child(this._blockedSection.actor);

            this._scrollContent.add_child(new PopupMenu.PopupSeparatorMenuItem());

            // Extension Settings (inside scroll so it's always reachable)
            let settingsItem = new PopupMenu.PopupMenuItem('Extension Settings');
            settingsItem.connect('activate', () => {
                this.menu.close();
                this._openExtensionPreferences();
            });
            this._scrollContent.add_child(settingsItem);

            this._scrollView.set_child(this._scrollContent);
            this._scrollViewItem.add_child(this._scrollView);

            this.menu.addMenuItem(this._scrollViewItem);


            this.connect('clicked', () => {
                this._handleToggleEvent(this.checked);
            });

            this._checkHotspotActiveState();
            this._startPollingLoop();

            this._openStateId = this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    this._refreshBandLabel();
                    if (this.checked) {
                        this._updateQRCode();
                    } else {
                        this._qrCodeContainer.hide();
                        if (this._qrSeparator) this._qrSeparator.hide();
                    }
                    this._updateDeviceLists();
                }
            });
        }

        _readBand() {
            let rawMode = '';
            let activeModeFile = '/tmp/wifi-hotspot-active-mode';
            if (this.checked && GLib.file_test(activeModeFile, GLib.FileTest.EXISTS)) {
                try {
                    let [success, content] = GLib.file_get_contents(activeModeFile);
                    if (success) {
                        let decoder = new TextDecoder('utf-8');
                        rawMode = decoder.decode(content).trim();
                    }
                } catch (e) { /* ignore */ }
            }

            if (!rawMode) {
                let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
                if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                    try {
                        let [success, content] = GLib.file_get_contents(path);
                        if (success) {
                            let decoder = new TextDecoder('utf-8');
                            let lines = decoder.decode(content).split('\n');
                            for (let line of lines) {
                                let match = line.match(/^(\w+)\s*=\s*"(.*)"$/);
                                if (match && match[1] === 'BAND') {
                                    rawMode = match[2];
                                }
                            }
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            if (rawMode.startsWith('5G') || rawMode === 'a') return '5GHz';
            if (rawMode.startsWith('6G')) return '6GHz';
            return '2.4GHz';
        }

        _refreshBandLabel() {
            let band = this._readBand();
            this._bandLabel = band;
            this.title = 'Hotspot';
            this.subtitle = this.checked ? band : 'Off';
            this.menu.setHeader('network-wireless-hotspot-symbolic', `Hotspot (${band})`, 'Manage connected clients');
        }

        _updateQRCode() {
            let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
            let ssid = 'hotspot';
            let usePassword = true;
            let password = '';
            
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                try {
                    let [success, content] = GLib.file_get_contents(path);
                    if (success) {
                        let decoder = new TextDecoder('utf-8');
                        let lines = decoder.decode(content).split('\n');
                        for (let line of lines) {
                            let match = line.match(/^(\w+)\s*=\s*"(.*)"$/);
                            if (match) {
                                let [_, key, value] = match;
                                if (key === 'SSID') ssid = value;
                                else if (key === 'USE_PASSWORD') usePassword = (value === 'true');
                                else if (key === 'PASSWORD') password = value;
                            }
                        }
                    }
                } catch (e) {
                    console.error(`[HotspotRouter] Failed to read config for QR code: ${e.message}`);
                }
            }
            
            let qrString = `WIFI:S:${ssid};T:${usePassword ? 'WPA' : 'nopass'};P:${usePassword ? password : ''};;`;
            
            if (this._lastQrString === qrString) {
                // Already generated — just ensure it's visible
                this._qrCodeContainer.show();
                if (this._qrSeparator) this._qrSeparator.show();
                return;
            }
            this._lastQrString = qrString;
            
            // Use a unique filename to bypass St.Icon texture caching when the password changes
            let qrFile = `/tmp/wifi-hotspot-qr-${Date.now()}.png`;
            
            // Clean up previous QR code file
            if (this._lastQrFile) {
                try { Gio.File.new_for_path(this._lastQrFile).delete(null); } catch(e) {}
            }
            this._lastQrFile = qrFile;
            
            this._runCommand(['qrencode', '-t', 'PNG', '-s', '5', '-o', qrFile, qrString], (success) => {
                if (success && GLib.file_test(qrFile, GLib.FileTest.EXISTS)) {
                    let gicon = Gio.FileIcon.new(Gio.File.new_for_path(qrFile));
                    this._qrCodeIcon.set_gicon(gicon);
                    this._qrCodeContainer.show();
                    if (this._qrSeparator) this._qrSeparator.show();
                } else {
                    // Reset so it retries next time (e.g. after user installs qrencode)
                    this._lastQrString = null;
                    this._qrCodeContainer.hide();
                    if (this._qrSeparator) this._qrSeparator.hide();
                }
            });
        }

        async _openExtensionPreferences() {
            try {
                await this._extension.openPreferences();
            } catch (err) {
                let msg = err ? (err.message || String(err)) : '';
                console.warn(`[HotspotRouter] Note on opening preferences: ${msg}`);
            }
        }

        _handleToggleEvent(shouldActivate) {
            let username = GLib.get_user_name();
            let serviceName = `wifi-hotspot@${username}.service`;
            let args = shouldActivate
                ? ['systemctl', 'start', serviceName]
                : ['systemctl', 'stop', serviceName];
            this._runCommand(args, () => {
                this._checkHotspotActiveState();
                this._refreshBandLabel();
                if (this.menu.isOpen) {
                    this._updateDeviceLists();
                }
            });
        }

        _runCommand(args, callback = null) {
            try {
                let proc = new Gio.Subprocess({
                    argv: args,
                    flags: callback ? Gio.SubprocessFlags.STDOUT_PIPE : Gio.SubprocessFlags.NONE
                });
                proc.init(null);
                if (callback) {
                    proc.communicate_utf8_async(null, null, (obj, res) => {
                        try {
                            let [success, stdout] = obj.communicate_utf8_finish(res);
                            callback(success, stdout);
                        } catch (err) {
                            callback(false, null);
                        }
                    });
                } else {
                    proc.wait_async(null, null);
                }
            } catch (e) {
                console.error(`[HotspotRouter] Failed executing command: ${e.message}`);
                if (callback) callback(false, null);
            }
        }

        _checkHotspotActiveState() {
            try {
                let username = GLib.get_user_name();
                let proc = new Gio.Subprocess({
                    argv: ['systemctl', 'is-active', `wifi-hotspot@${username}.service`],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE
                });
                proc.init(null);
                proc.communicate_utf8_async(null, null, (obj, res) => {
                    try {
                        let [success, stdout] = obj.communicate_utf8_finish(res);
                        let state = stdout ? stdout.trim() : '';
                        let active = success && (state === 'active' || state === 'activating');
                        if (this.checked !== active) {
                            this.checked = active;
                            this._refreshBandLabel();
                        }
                    } catch (err) {

                    }
                });
            } catch (e) {

            }
        }

        _updateDeviceLists() {
            let username = GLib.get_user_name();

            this._runCommand(['sudo', '/usr/local/bin/manage_hotspot_clients', 'list', '', username], (success, stdout) => {
                this._connectedSection.removeAll();

                let header = new PopupMenu.PopupMenuItem('Connected Devices', { reactive: false });
                header.label.add_style_class_name('bold');
                this._connectedSection.addMenuItem(header);

                let activeCount = 0;
                if (success && stdout && stdout.trim()) {
                    let lines = stdout.trim().split('\n');
                    for (let line of lines) {
                        if (!line) continue;
                        activeCount++;
                        let parts = line.split('|');
                        let mac = parts[0];
                        let hostname = parts.length > 1 ? parts[1] : mac;
                        let rxBytes = parts.length > 2 ? parseInt(parts[2], 10) || 0 : 0;
                        let txBytes = parts.length > 3 ? parseInt(parts[3], 10) || 0 : 0;
                        let bitrate = parts.length > 4 ? parts[4] : '';
                        let ip = parts.length > 5 ? parts[5] : '';

                        let item = new PopupMenu.PopupMenuItem('');
                        let infoBox = new St.BoxLayout({ vertical: true, x_expand: true });
                        let nameLabel = new St.Label({ text: hostname, style: 'font-weight: 500;' });
                        infoBox.add_child(nameLabel);

                        let totalBytes = rxBytes + txBytes;
                        let formatBytes = (b) => {
                            if (!b || b <= 0) return '0 B';
                            let units = ['B', 'KB', 'MB', 'GB', 'TB'];
                            let i = Math.floor(Math.log(b) / Math.log(1024));
                            return (b / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
                        };
                        let subText = '';
                        if (ip && ip !== 'Unknown IP') subText += `${ip} • `;
                        subText += `${formatBytes(totalBytes)} transferred`;
                        if (bitrate) subText += ` • ${bitrate}`;
                        let subLabel = new St.Label({
                            text: subText,
                            style: 'font-size: 0.82em; opacity: 0.7;'
                        });
                        infoBox.add_child(subLabel);
                        item.add_child(infoBox);

                        let blockBtn = new St.Button({
                            style_class: 'button',
                            child: new St.Label({
                                text: 'Block',
                                style: 'font-size: 11px; font-weight: 600; padding: 0; margin: 0;'
                            }),
                            style: 'padding: 2px 10px; margin-left: 8px; margin-right: 4px; min-width: 55px; height: 24px;',
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER,
                        });

                        blockBtn.connect('clicked', () => {
                            this._runCommand(['sudo', '/usr/local/bin/manage_hotspot_clients', 'block', mac, username, hostname], () => {
                                this._updateDeviceLists();
                            });
                        });
                        item.add_child(blockBtn);
                        this._connectedSection.addMenuItem(item);
                    }
                } else {
                    let item = new PopupMenu.PopupMenuItem('No devices connected', { reactive: false });
                    this._connectedSection.addMenuItem(item);
                }
                this._clientCount = activeCount;
            });


            this._runCommand(['sudo', '/usr/local/bin/manage_hotspot_clients', 'list_blocked', '', username], (success, stdout) => {
                this._blockedSection.removeAll();

                let header = new PopupMenu.PopupMenuItem('Blocked Devices', { reactive: false });
                header.label.add_style_class_name('bold');
                this._blockedSection.addMenuItem(header);

                if (success && stdout && stdout.trim()) {
                    let lines = stdout.trim().split('\n');
                    for (let line of lines) {
                        if (!line) continue;
                        let parts = line.split('|');
                        let mac = parts[0];
                        let hostname = parts.length > 1 ? parts[1] : mac;

                        let item = new PopupMenu.PopupMenuItem(hostname);

                        let unblockBtn = new St.Button({
                            style_class: 'button',
                            child: new St.Label({
                                text: 'Unblock',
                                style: 'font-size: 11px; font-weight: 600; padding: 0; margin: 0;'
                            }),
                            style: 'padding: 2px 10px; margin-left: 8px; margin-right: 4px; min-width: 65px; height: 24px;',
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER,
                        });

                        unblockBtn.connect('clicked', () => {
                            this._runCommand(['sudo', '/usr/local/bin/manage_hotspot_clients', 'unblock', mac, username], () => {
                                this._updateDeviceLists();
                            });
                        });
                        item.add_child(unblockBtn);
                        this._blockedSection.addMenuItem(item);
                    }
                } else {
                    let item = new PopupMenu.PopupMenuItem('No devices blocked', { reactive: false });
                    this._blockedSection.addMenuItem(item);
                }
            });
        }

        _readAdvancedConfig() {
            let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
            let config = { idleTimeout: 0, inhibitSleep: false };
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                try {
                    let [success, content] = GLib.file_get_contents(path);
                    if (success) {
                        let lines = (new TextDecoder('utf-8')).decode(content).split('\n');
                        for (let line of lines) {
                            let m = line.match(/^(\w+)\s*=\s*"(.*)"$/);
                            if (m) {
                                if (m[1] === 'IDLE_TIMEOUT') config.idleTimeout = parseInt(m[2], 10) || 0;
                                else if (m[1] === 'INHIBIT_SLEEP') config.inhibitSleep = (m[2] === 'true');
                            }
                        }
                    }
                } catch(e) {}
            }
            return config;
        }

        _startPollingLoop() {
            if (this._timeoutId > 0) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
            }

            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._checkHotspotActiveState();
                if (this.menu.isOpen) {
                    this._updateDeviceLists();
                }

                // Background idle timeout & sleep inhibitor handling
                if (this.checked) {
                    let adv = this._readAdvancedConfig();
                    // Use the cached client count from _updateDeviceLists instead of
                    // spawning a duplicate sudo subprocess every 3 seconds
                    let count = this._clientCount;

                    // Sleep inhibitor management
                    if (adv.inhibitSleep && count > 0 && this._inhibitCookie === 0 && !this._inhibitPending) {
                        this._inhibitPending = true;
                        try {
                            Gio.DBus.session.call(
                                'org.gnome.SessionManager',
                                '/org/gnome/SessionManager',
                                'org.gnome.SessionManager',
                                'Inhibit',
                                new GLib.Variant('(susu)', ['wifi-hotspot-router', 0, 'Hotspot is actively sharing internet', 4]),
                                null,
                                Gio.DBusCallFlags.NONE,
                                -1,
                                null,
                                (obj, res) => {
                                    this._inhibitPending = false;
                                    try {
                                        let r = obj.call_finish(res);
                                        this._inhibitCookie = r.deepUnpack()[0];
                                    } catch(e) {}
                                }
                            );
                        } catch(e) { this._inhibitPending = false; }
                    } else if ((!adv.inhibitSleep || count === 0) && this._inhibitCookie > 0) {
                        this._releaseInhibit();
                        }

                    // Auto-turn off when idle
                    if (count === 0) {
                        this._idleSeconds += 3;
                        if (adv.idleTimeout > 0 && this._idleSeconds >= (adv.idleTimeout * 60)) {
                            this._handleToggleEvent(false);
                            this._idleSeconds = 0;
                        }
                    } else {
                        this._idleSeconds = 0;
                    }
                } else {
                    this._idleSeconds = 0;
                    this._releaseInhibit();
                }

                return GLib.SOURCE_CONTINUE;
            });
        }

        _releaseInhibit() {
            if (this._inhibitCookie > 0) {
                try {
                    Gio.DBus.session.call(
                        'org.gnome.SessionManager',
                        '/org/gnome/SessionManager',
                        'org.gnome.SessionManager',
                        'Uninhibit',
                        new GLib.Variant('(u)', [this._inhibitCookie]),
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        null
                    );
                } catch(e) {}
                this._inhibitCookie = 0;
            }
        }

        destroy() {
            this._releaseInhibit();
            if (this._timeoutId > 0) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
            }
            if (this._openStateId > 0) {
                this.menu.disconnect(this._openStateId);
                this._openStateId = 0;
            }
            // Clean up temporary QR code file
            if (this._lastQrFile) {
                try { Gio.File.new_for_path(this._lastQrFile).delete(null); } catch(e) {}
                this._lastQrFile = null;
            }
            super.destroy();
        }
    });

const HotspotRouterIndicator = GObject.registerClass(
    class HotspotRouterIndicator extends QuickSettings.SystemIndicator {
        _init(extension) {
            super._init();
            this._extension = extension;


            this._toggle = new HotspotRouterToggle(extension);


            this.quickSettingsItems.push(this._toggle);
        }

        destroy() {
            if (this._toggle) {
                this._toggle.destroy();
                this._toggle = null;
            }
            super.destroy();
        }
    });

export default class HotspotRouterExtension extends Extension {
    enable() {
        this._indicator = new HotspotRouterIndicator(this);
        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.addExternalIndicator(this._indicator);

        this._repositionToggle(quickSettings);

        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._repositionToggle(quickSettings);
            return GLib.SOURCE_REMOVE;
        });
    }

    _repositionToggle(quickSettings) {
        try {
            const toggle = this._indicator?._toggle;
            if (!toggle) return;

            const grid = quickSettings?.menu?._grid;
            if (!grid) return;

            const children = grid.get_children();
            if (!children || children.length === 0) return;

            // Find last network item in Quick Settings grid
            const networkItems = quickSettings._network?.quickSettingsItems;
            let sibling = null;

            if (networkItems && networkItems.length > 0) {
                const lastNetItem = networkItems[networkItems.length - 1];
                const netIdx = children.indexOf(lastNetItem);
                if (netIdx !== -1 && netIdx + 1 < children.length) {
                    sibling = children[netIdx + 1];
                }
            }

            // Fallback to Bluetooth toggle if network items not found
            if (!sibling && quickSettings._bluetooth?.quickSettingsItems?.length > 0) {
                sibling = quickSettings._bluetooth.quickSettingsItems[0];
            }

            if (sibling && sibling !== toggle) {
                grid.set_child_below_sibling(toggle, sibling);
            }
        } catch (e) {
            console.error(`[HotspotRouter] Failed to reposition toggle beside Wi-Fi: ${e.message}`);
        }
    }

    disable() {
        if (this._idleId) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

