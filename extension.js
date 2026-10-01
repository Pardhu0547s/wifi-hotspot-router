import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import NM from 'gi://NM';

const HotspotRouterToggle = GObject.registerClass(
    class HotspotRouterToggle extends QuickSettings.QuickMenuToggle {
        _init(extension) {
            this._extension = extension;
            this._timeoutId = 0;
            this._destroyed = false;
            this._activeSubprocesses = [];
            this._qrIndex = 0;
            this._lastQrString = null;
            this._lastStatusOutput = null;
            this._cachedConfig = null;
            this._isTransitioning = false;
            this._isHandover = false;
            this._handoverRestartTimeoutId = 0;
            this._nmClient = null;
            this._nmSignalIds = [];
            this._deviceSignalIds = [];

            super._init({
                title: 'Hotspot',
                iconName: 'network-wireless-hotspot-symbolic',
                toggleMode: true,
            });

            this._cachedConfig = this._loadConfig();
            this._bandLabel = this._readBand();
            this.subtitle = this.checked ? this._bandLabel : 'Off';
            let initialStatus = this.checked ? 'Active • Manage connected clients' : 'Inactive • Manage connected clients';
            this.menu.setHeader('network-wireless-hotspot-symbolic', `Hotspot (${this._bandLabel})`, initialStatus);

            this._scrollViewItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'hotspot-scrollview',
            });
            this._scrollViewItem.y_expand = true;

            this._scrollView = new St.ScrollView({
                style_class: 'vfade hotspot-scrollview',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true,
            });

            this._scrollContent = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });

            // Collapsible QR Code Toggle Item
            this._qrVisible = false;
            this._qrToggleItem = new PopupMenu.PopupMenuItem('Show Wi-Fi QR Code');
            this._qrToggleItem.connect('activate', () => {
                this._qrVisible = !this._qrVisible;
                this._qrToggleItem.label.text = this._qrVisible ? 'Hide Wi-Fi QR Code' : 'Show Wi-Fi QR Code';
                if (this._qrVisible) {
                    this._updateQRCode();
                } else {
                    this._qrCodeContainer.hide();
                    this._qrSeparator.hide();
                }
            });
            this._scrollContent.add_child(this._qrToggleItem);
            this._qrToggleItem.hide();

            // QR Code view
            this._qrCodeContainer = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_expand: false,
                style_class: 'hotspot-qr-container',
            });
            this._qrCodeIcon = new St.Icon({
                icon_size: 180,
                width: 180,
                height: 180,
            });
            this._qrCodeContainer.set_child(this._qrCodeIcon);
            this._scrollContent.add_child(this._qrCodeContainer);
            this._qrCodeContainer.hide();

            this._qrSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this._scrollContent.add_child(this._qrSeparator);
            this._qrSeparator.hide();

            // Client device sections
            this._connectedVisible = false;
            this._connectedCount = 0;
            this._connectedToggleItem = new PopupMenu.PopupMenuItem('Show Connected Devices');
            this._connectedToggleItem.connect('activate', () => {
                this._connectedVisible = !this._connectedVisible;
                this._updateConnectedToggleLabel();
                if (this._connectedVisible) {
                    this._connectedSection.actor.show();
                    this._updateDeviceLists();
                } else {
                    this._connectedSection.actor.hide();
                }
            });
            this._scrollContent.add_child(this._connectedToggleItem);
            this._connectedToggleItem.hide();

            this._connectedSection = new PopupMenu.PopupMenuSection();
            this._scrollContent.add_child(this._connectedSection.actor);
            this._connectedSection.actor.hide();

            this._blockedVisible = false;
            this._blockedCount = 0;
            this._blockedToggleItem = new PopupMenu.PopupMenuItem('Show Blocked Devices');
            this._blockedToggleItem.connect('activate', () => {
                this._blockedVisible = !this._blockedVisible;
                this._updateBlockedToggleLabel();
                if (this._blockedVisible) {
                    this._blockedSection.actor.show();
                    this._updateDeviceLists();
                } else {
                    this._blockedSection.actor.hide();
                }
            });
            this._scrollContent.add_child(this._blockedToggleItem);
            this._blockedToggleItem.hide();

            this._blockedSection = new PopupMenu.PopupMenuSection();
            this._scrollContent.add_child(this._blockedSection.actor);
            this._blockedSection.actor.hide();

            this._scrollContent.add_child(new PopupMenu.PopupSeparatorMenuItem());

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

            this._settings = null;
            this._settingsChangedId = 0;
            try {
                this._settings = this._extension.getSettings();
                this._settingsChangedId = this._settings.connect('changed', () => {
                    this._cachedConfig = this._loadConfig();
                    this._refreshBandLabel();
                    if (this.menu.isOpen && this.checked && this._qrVisible) {
                        this._updateQRCode();
                    }
                });
            } catch (e) { }

            this._checkHotspotActiveState();
            this._startPollingLoop();
            this._initNMClient();

            this._openStateId = this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    this._cachedConfig = this._loadConfig();
                    this._refreshBandLabel();
                    if (this.checked) {
                        this._qrToggleItem.show();
                        this._connectedToggleItem.show();
                        this._blockedToggleItem.show();
                        if (this._qrVisible) {
                            this._updateQRCode(true);
                        }
                        if (this._connectedVisible) {
                            this._connectedSection.actor.show();
                        } else {
                            this._connectedSection.actor.hide();
                        }
                        if (this._blockedVisible) {
                            this._blockedSection.actor.show();
                        } else {
                            this._blockedSection.actor.hide();
                        }
                        this._updateDeviceLists();
                    } else {
                        this._qrToggleItem.hide();
                        this._connectedToggleItem.hide();
                        this._blockedToggleItem.hide();
                        this._connectedSection.actor.hide();
                        this._blockedSection.actor.hide();
                        this._qrVisible = false;
                        this._connectedVisible = false;
                        this._blockedVisible = false;
                        this._qrToggleItem.label.text = 'Show Wi-Fi QR Code';
                        this._updateConnectedToggleLabel();
                        this._updateBlockedToggleLabel();
                        this._qrCodeContainer.hide();
                        this._qrSeparator.hide();
                        this._clearDeviceLists();
                    }
                }
            });
        }

        _updateConnectedToggleLabel() {
            let countStr = this._connectedCount > 0 ? ` (${this._connectedCount})` : '';
            this._connectedToggleItem.label.text = this._connectedVisible
                ? `Hide Connected Devices${countStr}`
                : `Show Connected Devices${countStr}`;
        }

        _updateBlockedToggleLabel() {
            let countStr = this._blockedCount > 0 ? ` (${this._blockedCount})` : '';
            this._blockedToggleItem.label.text = this._blockedVisible
                ? `Hide Blocked Devices${countStr}`
                : `Show Blocked Devices${countStr}`;
        }

        _loadConfig() {
            let config = {
                ssid: 'hotspot',
                password: '',
                band: 'bg',
            };

            let path = GLib.get_user_config_dir() + '/wifi-hotspot.conf';
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                try {
                    let [success, content] = GLib.file_get_contents(path);
                    if (success) {
                        let lines = new TextDecoder('utf-8').decode(content).split('\n');
                        for (let line of lines) {
                            line = line.replace(/\r/g, '').trim();
                            if (!line) continue;
                            let match = line.match(/^(\w+)\s*=\s*"(.*)"$/);
                            if (match) {
                                let [, key, val] = match;
                                switch (key) {
                                    case 'SSID': config.ssid = val; break;
                                    case 'PASSWORD': if (val) config.password = val; break;
                                    case 'BAND': config.band = val; break;
                                }
                            }
                        }
                    }
                } catch (e) { }
            }

            if (!config.password) {
                try {
                    config.password = GLib.uuid_string_random().replace(/-/g, '').substring(0, 12);
                } catch (e) {
                    config.password = 'hotspot' + Math.floor(Math.random() * 8999 + 1000);
                }
                try {
                    let configDir = GLib.get_user_config_dir();
                    GLib.mkdir_with_parents(configDir, 448);
                    let output = `SSID="${config.ssid}"\nPASSWORD="${config.password}"\nBAND="${config.band}"\n`;
                    GLib.file_set_contents(path, output);
                    GLib.chmod(path, 384);
                } catch (e) { }
            }

            return config;
        }

        _readBand() {
            let rawMode = '';
            let activeModeFile = '/run/wifi-hotspot/active-mode';
            if (this.checked && GLib.file_test(activeModeFile, GLib.FileTest.EXISTS)) {
                try {
                    let [success, content] = GLib.file_get_contents(activeModeFile);
                    if (success) {
                        rawMode = new TextDecoder('utf-8').decode(content).trim();
                    }
                } catch (e) { }
            }

            if (!rawMode) {
                let conf = this._cachedConfig || this._loadConfig();
                rawMode = conf.band;
            }

            if (rawMode.startsWith('5G') || rawMode === 'a') return '5GHz';
            if (rawMode.startsWith('6G')) return '6GHz';
            return '2.4GHz';
        }

        _refreshBandLabel() {
            let band = this._readBand();
            this._bandLabel = band;
            if (!this._isTransitioning) {
                this.subtitle = this.checked ? band : 'Off';
            }
            let statusText = this._isTransitioning
                ? (this.subtitle || 'Transitioning...')
                : (this.checked ? 'Active • Manage connected clients' : 'Inactive • Manage connected clients');
            this.menu.setHeader('network-wireless-hotspot-symbolic', `Hotspot (${band})`, statusText);
        }

        _updateQRCode(forceRefresh = false) {
            this._cachedConfig = this._loadConfig();
            let conf = this._cachedConfig;
            const escapeQr = str => (str || '').replace(/([\\;:,"\/])/g, '\\$1');
            let qrString = `WIFI:S:${escapeQr(conf.ssid)};T:WPA;P:${escapeQr(conf.password)};;`;

            if (!forceRefresh && this._lastQrString === qrString && this._qrCodeContainer.visible) {
                return;
            }
            this._lastQrString = qrString;

            let runtimeDir = GLib.get_user_runtime_dir() || '/tmp';
            let username = GLib.get_user_name();
            let timestamp = Date.now();
            let qrFile = GLib.build_filenamev([runtimeDir, `wifi-hotspot-qr-${username}-${timestamp}.png`]);

            try {
                let dir = Gio.File.new_for_path(runtimeDir);
                let enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    let name = info.get_name();
                    if (name.startsWith(`wifi-hotspot-qr-${username}-`)) {
                        try {
                            dir.get_child(name).delete(null);
                        } catch (e) { }
                    }
                }
            } catch (e) { }

            try {
                let proc = new Gio.Subprocess({
                    argv: ['qrencode', '-t', 'PNG', '-s', '5', '-o', qrFile],
                    flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
                });
                proc.init(null);
                this._activeSubprocesses.push(proc);
                proc.communicate_utf8_async(qrString, null, (obj, res) => {
                    this._activeSubprocesses = this._activeSubprocesses.filter(p => p !== obj);
                    if (this._destroyed) return;
                    try {
                        obj.communicate_utf8_finish(res);
                        let ok = obj.get_successful();
                        if (ok && GLib.file_test(qrFile, GLib.FileTest.EXISTS)) {
                            let gicon = Gio.FileIcon.new(Gio.File.new_for_path(qrFile));
                            this._qrCodeIcon.set_gicon(null);
                            this._qrCodeIcon.set_gicon(gicon);
                            if (this._qrVisible) {
                                this._qrCodeContainer.show();
                                this._qrSeparator.show();
                            }
                        } else {
                            this._lastQrString = null;
                            this._qrCodeContainer.hide();
                            this._qrSeparator.hide();
                        }
                    } catch (err) {
                        this._lastQrString = null;
                        this._qrCodeContainer.hide();
                        this._qrSeparator.hide();
                    }
                });
            } catch (e) {
                this._lastQrString = null;
                this._qrCodeContainer.hide();
                this._qrSeparator.hide();
            }
        }

        async _openExtensionPreferences() {
            try {
                await this._extension.openPreferences();
            } catch (err) {
                console.warn(`[HotspotRouter] Note opening preferences: ${err?.message || err}`);
            }
        }

        _handleToggleEvent(shouldActivate) {
            this._isTransitioning = true;
            this._isHandover = false;
            if (this._handoverRestartTimeoutId > 0) {
                GLib.source_remove(this._handoverRestartTimeoutId);
                this._handoverRestartTimeoutId = 0;
            }
            if (this._handoverWatchdogId > 0) {
                GLib.source_remove(this._handoverWatchdogId);
                this._handoverWatchdogId = 0;
            }
            this.subtitle = shouldActivate ? 'Starting...' : 'Stopping...';
            this.menu.setHeader('network-wireless-hotspot-symbolic', `Hotspot (${this._bandLabel})`, shouldActivate ? 'Starting hotspot...' : 'Stopping hotspot...');

            if (shouldActivate) {
                try {
                    let errFile = Gio.File.new_for_path('/run/wifi-hotspot/last-error');
                    errFile.delete(null);
                } catch (e) { }
            }

            let username = GLib.get_user_name();
            let serviceName = `wifi-hotspot@${username}.service`;
            let args = shouldActivate
                ? ['systemctl', 'start', serviceName]
                : ['systemctl', 'stop', serviceName];

            this._runCommand(args, () => {
                this._isTransitioning = false;
                this._checkHotspotActiveState();
                this._refreshBandLabel();
                if (shouldActivate && !this.checked) {
                    let errPath = '/run/wifi-hotspot/last-error';
                    if (GLib.file_test(errPath, GLib.FileTest.EXISTS)) {
                        try {
                            let [ok, content] = GLib.file_get_contents(errPath);
                            if (ok) {
                                let msg = new TextDecoder('utf-8').decode(content).trim();
                                if (msg) {
                                    Main.notify('Wi-Fi Hotspot Router', msg);
                                }
                            }
                        } catch (e) { }
                    }
                }
                if (this.menu.isOpen) {
                    if (this.checked) {
                        this._qrToggleItem.show();
                        this._connectedToggleItem.show();
                        this._blockedToggleItem.show();
                        if (this._qrVisible) {
                            this._updateQRCode();
                        }
                        if (this._connectedVisible) {
                            this._connectedSection.actor.show();
                        }
                        if (this._blockedVisible) {
                            this._blockedSection.actor.show();
                        }
                        this._updateDeviceLists();
                    } else {
                        this._qrToggleItem.hide();
                        this._connectedToggleItem.hide();
                        this._blockedToggleItem.hide();
                        this._connectedSection.actor.hide();
                        this._blockedSection.actor.hide();
                        this._qrVisible = false;
                        this._connectedVisible = false;
                        this._blockedVisible = false;
                        this._qrToggleItem.label.text = 'Show Wi-Fi QR Code';
                        this._updateConnectedToggleLabel();
                        this._updateBlockedToggleLabel();
                        this._qrCodeContainer.hide();
                        this._qrSeparator.hide();
                        this._clearDeviceLists();
                    }
                }
            });
        }

        _runCommand(args, callback = null) {
            try {
                let proc = new Gio.Subprocess({
                    argv: args,
                    flags: callback ? Gio.SubprocessFlags.STDOUT_PIPE : Gio.SubprocessFlags.NONE,
                });
                proc.init(null);
                this._activeSubprocesses.push(proc);
                if (callback) {
                    proc.communicate_utf8_async(null, null, (obj, res) => {
                        this._activeSubprocesses = this._activeSubprocesses.filter(p => p !== obj);
                        if (this._destroyed) return;
                        try {
                            let [, stdout] = obj.communicate_utf8_finish(res);
                            let ok = obj.get_successful();
                            callback(ok, stdout);
                        } catch (err) {
                            callback(false, null);
                        }
                    });
                } else {
                    proc.wait_async(null, (obj, res) => {
                        this._activeSubprocesses = this._activeSubprocesses.filter(p => p !== obj);
                        try { obj.wait_finish(res); } catch (e) { }
                    });
                }
            } catch (e) {
                if (callback) callback(false, null);
            }
        }

        _checkHotspotActiveState() {
            try {
                let username = GLib.get_user_name();
                let unitName = `wifi-hotspot@${username}.service`;

                Gio.DBus.system.call(
                    'org.freedesktop.systemd1',
                    '/org/freedesktop/systemd1',
                    'org.freedesktop.systemd1.Manager',
                    'ListUnitsByNames',
                    new GLib.Variant('(as)', [[unitName]]),
                    new GLib.VariantType('(a(ssssssouso))'),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (conn, res) => {
                        if (this._destroyed) return;
                        try {
                            let reply = conn.call_finish(res);
                            let [units] = reply.deepUnpack();
                            let active = false;
                            if (units && units.length > 0) {
                                let state = units[0][3];
                                active = (state === 'active' || state === 'activating');
                            }
                            if (this.checked !== active) {
                                this.checked = active;
                                if (!this._isTransitioning) {
                                    this._refreshBandLabel();
                                }
                            }
                        } catch (e) {
                            if (this.checked) {
                                this.checked = false;
                                this._refreshBandLabel();
                            }
                        }
                    }
                );
            } catch (e) { }
        }

        _initNMClient() {
            try {
                NM.Client.new_async(null, (obj, res) => {
                    if (this._destroyed) return;
                    try {
                        this._nmClient = NM.Client.new_finish(res);
                        this._setupDeviceWatchers();

                        let addedId = this._nmClient.connect('device-added', () => this._setupDeviceWatchers());
                        let removedId = this._nmClient.connect('device-removed', () => this._setupDeviceWatchers());
                        this._nmSignalIds.push({ obj: this._nmClient, id: addedId });
                        this._nmSignalIds.push({ obj: this._nmClient, id: removedId });
                    } catch (err) { }
                });
            } catch (err) { }
        }

        _setupDeviceWatchers() {
            if (this._destroyed || !this._nmClient) return;

            for (let { dev, id } of this._deviceSignalIds) {
                try {
                    if (GObject.signal_handler_is_connected(dev, id)) {
                        dev.disconnect(id);
                    }
                } catch (e) { }
            }
            this._deviceSignalIds = [];

            let devices = this._nmClient.get_devices() || [];
            for (let dev of devices) {
                let type = dev.get_device_type();
                if (type === NM.DeviceType.WIFI) {
                    let iface = dev.get_iface();
                    if (iface && (iface === 'ap0' || iface === 'ap1' || iface.endsWith('_ap'))) {
                        continue;
                    }

                    let sigId = dev.connect('state-changed', (d, newState, oldState, reason) => {
                        this._onDeviceStateChanged(d, newState, oldState, reason);
                    });
                    this._deviceSignalIds.push({ dev, id: sigId });
                }
            }
        }

        _onDeviceStateChanged(dev, newState, oldState, reason) {
            let username = GLib.get_user_name();
            let serviceName = `wifi-hotspot@${username}.service`;

            // When user initiates Wi-Fi association to another network
            if (newState === NM.DeviceState.PREPARE || newState === NM.DeviceState.CONFIG || newState === NM.DeviceState.NEED_AUTH) {
                if (this.checked && !this._isTransitioning && !this._isHandover) {
                    this._isHandover = true;
                    if (this._handoverWatchdogId > 0) {
                        GLib.source_remove(this._handoverWatchdogId);
                    }
                    this._handoverWatchdogId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
                        this._handoverWatchdogId = 0;
                        if (this._isHandover) {
                            this._isHandover = false;
                            this._checkHotspotActiveState();
                            this._refreshBandLabel();
                        }
                        return GLib.SOURCE_REMOVE;
                    });

                    this.subtitle = 'Switching Wi-Fi...';
                    this.menu.setHeader(
                        'network-wireless-hotspot-symbolic',
                        `Hotspot (${this._bandLabel})`,
                        'Switching Wi-Fi network...'
                    );

                    this._runCommand(['systemctl', 'stop', serviceName]);
                }
            } else if (newState === NM.DeviceState.ACTIVATED) {
                if (this._isHandover) {
                    if (this._handoverWatchdogId > 0) {
                        GLib.source_remove(this._handoverWatchdogId);
                        this._handoverWatchdogId = 0;
                    }
                    if (this._handoverRestartTimeoutId > 0) {
                        GLib.source_remove(this._handoverRestartTimeoutId);
                        this._handoverRestartTimeoutId = 0;
                    }

                    this.subtitle = 'Resuming hotspot...';
                    this._handoverRestartTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                        this._handoverRestartTimeoutId = 0;
                        if (this._destroyed || !this._isHandover) return GLib.SOURCE_REMOVE;

                        this._runCommand(['systemctl', 'start', serviceName], () => {
                            this._isHandover = false;
                            this._checkHotspotActiveState();
                            this._refreshBandLabel();
                            if (this.menu.isOpen && this.checked) {
                                this._updateQRCode();
                                this._updateDeviceLists();
                            }
                        });
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else if (newState === NM.DeviceState.FAILED || (newState === NM.DeviceState.DISCONNECTED && oldState === NM.DeviceState.CONFIG)) {
                if (this._isHandover) {
                    if (this._handoverWatchdogId > 0) {
                        GLib.source_remove(this._handoverWatchdogId);
                        this._handoverWatchdogId = 0;
                    }
                    if (this._handoverRestartTimeoutId > 0) {
                        GLib.source_remove(this._handoverRestartTimeoutId);
                        this._handoverRestartTimeoutId = 0;
                    }

                    this.subtitle = 'Recovering hotspot...';
                    this._handoverRestartTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                        this._handoverRestartTimeoutId = 0;
                        if (this._destroyed || !this._isHandover) return GLib.SOURCE_REMOVE;

                        this._runCommand(['systemctl', 'start', serviceName], () => {
                            this._isHandover = false;
                            this._checkHotspotActiveState();
                            this._refreshBandLabel();
                        });
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        }

        _createBlockedItem(bmac, bhost, username) {
            let item = new PopupMenu.PopupBaseMenuItem({ activate: false });
            let nameLabel = new St.Label({
                text: bhost,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'hotspot-device-title',
            });
            item.add_child(nameLabel);

            let unblockBtn = new St.Button({
                style_class: 'button hotspot-action-btn',
                child: new St.Label({
                    text: 'Unblock',
                    style_class: 'hotspot-action-btn-label',
                }),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            unblockBtn.connect('clicked', () => {
                this._lastStatusOutput = null;
                this._runCommand(['pkexec', '--disable-internal-agent', '/usr/local/bin/manage_hotspot_clients', 'unblock', bmac, username], () => {
                    this._updateDeviceLists();
                });
            });
            item.add_child(unblockBtn);
            return item;
        }

        _clearDeviceLists() {
            this._lastStatusOutput = null;
            this._connectedCount = 0;
            this._blockedCount = 0;
            this._connectedSection.removeAll();
            this._blockedSection.removeAll();
            this._updateConnectedToggleLabel();
            this._updateBlockedToggleLabel();
        }

        _updateDeviceLists() {
            if (!this.checked) {
                this._clearDeviceLists();
                return;
            }

            let username = GLib.get_user_name();

            this._runCommand(['pkexec', '--disable-internal-agent', '/usr/local/bin/manage_hotspot_clients', 'status', '', username], (success, stdout) => {
                if (this._destroyed || !this.menu.isOpen) return;
                if (!success || !stdout) return;

                let outputText = stdout.trim();

                if (this._lastStatusOutput === outputText) {
                    return;
                }
                this._lastStatusOutput = outputText;

                this._connectedSection.removeAll();
                this._blockedSection.removeAll();

                let activeCount = 0;
                let blockedCount = 0;

                let parts = outputText.split('===BLOCKED===');
                let connPart = parts[0] ? parts[0].replace('===CONNECTED===', '').trim() : '';
                let blockPart = parts[1] ? parts[1].trim() : '';

                if (connPart) {
                    let lines = connPart.split('\n');
                    for (let line of lines) {
                        if (!line.trim()) continue;
                        activeCount++;
                        let fields = line.split('|');
                        let mac = fields[0];
                        let hostname = fields.length > 1 ? fields[1] : mac;

                        let item = new PopupMenu.PopupBaseMenuItem({ activate: false });
                        let nameLabel = new St.Label({
                            text: hostname,
                            x_expand: true,
                            y_align: Clutter.ActorAlign.CENTER,
                            style_class: 'hotspot-device-title',
                        });
                        item.add_child(nameLabel);

                        let blockBtn = new St.Button({
                            style_class: 'button hotspot-action-btn',
                            child: new St.Label({
                                text: 'Block',
                                style_class: 'hotspot-action-btn-label',
                            }),
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER,
                        });

                        blockBtn.connect('clicked', () => {
                            this._lastStatusOutput = null;
                            this._runCommand(['pkexec', '--disable-internal-agent', '/usr/local/bin/manage_hotspot_clients', 'block', mac, username, hostname], () => {
                                this._updateDeviceLists();
                            });
                        });
                        item.add_child(blockBtn);
                        this._connectedSection.addMenuItem(item);
                    }
                }

                if (blockPart) {
                    let lines = blockPart.split('\n');
                    for (let line of lines) {
                        if (!line.trim()) continue;
                        blockedCount++;
                        let bfields = line.split('|');
                        let bmac = bfields[0];
                        let bhost = bfields.length > 1 ? bfields[1] : bmac;
                        this._blockedSection.addMenuItem(this._createBlockedItem(bmac, bhost, username));
                    }
                }

                if (activeCount === 0) {
                    this._connectedSection.addMenuItem(new PopupMenu.PopupMenuItem('No devices connected', { reactive: false }));
                }
                if (blockedCount === 0) {
                    this._blockedSection.addMenuItem(new PopupMenu.PopupMenuItem('No devices blocked', { reactive: false }));
                }

                this._connectedCount = activeCount;
                this._blockedCount = blockedCount;
                this._updateConnectedToggleLabel();
                this._updateBlockedToggleLabel();
            });
        }

        _startPollingLoop() {
            if (this._timeoutId > 0) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
            }

            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._checkHotspotActiveState();
                if (this.menu.isOpen && this.checked) {
                    this._updateDeviceLists();
                }
                return GLib.SOURCE_CONTINUE;
            });
        }

        destroy() {
            this._destroyed = true;
            if (this._handoverRestartTimeoutId > 0) {
                GLib.source_remove(this._handoverRestartTimeoutId);
                this._handoverRestartTimeoutId = 0;
            }
            if (this._handoverWatchdogId > 0) {
                GLib.source_remove(this._handoverWatchdogId);
                this._handoverWatchdogId = 0;
            }
            for (let { obj, id } of this._nmSignalIds) {
                try {
                    if (GObject.signal_handler_is_connected(obj, id)) {
                        obj.disconnect(id);
                    }
                } catch (e) { }
            }
            this._nmSignalIds = [];
            for (let { dev, id } of this._deviceSignalIds) {
                try {
                    if (GObject.signal_handler_is_connected(dev, id)) {
                        dev.disconnect(id);
                    }
                } catch (e) { }
            }
            this._deviceSignalIds = [];

            if (this._timeoutId > 0) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
            }
            if (this._openStateId > 0) {
                this.menu.disconnect(this._openStateId);
                this._openStateId = 0;
            }
            if (this._settings && this._settingsChangedId > 0) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
            for (let proc of this._activeSubprocesses) {
                try { proc.force_exit(); } catch (e) { }
            }
            this._activeSubprocesses = [];

            let runtimeDir = GLib.get_user_runtime_dir() || '/tmp';
            let username = GLib.get_user_name();
            for (let i = 0; i < 2; i++) {
                try {
                    Gio.File.new_for_path(GLib.build_filenamev([runtimeDir, `wifi-hotspot-qr-${username}-${i}.png`])).delete(null);
                } catch (e) { }
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

        if (!this._repositionToggle(quickSettings)) {
            this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idleId = 0;
                if (this._indicator) {
                    this._repositionToggle(quickSettings);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _repositionToggle(quickSettings) {
        try {
            const toggle = this._indicator?._toggle;
            if (!toggle) return false;

            const grid = quickSettings?.menu?._grid;
            if (!grid) return false;

            const children = grid.get_children();
            if (!children || children.length === 0) return false;

            const networkItems = quickSettings._network?.quickSettingsItems;
            let targetSibling = null;
            let placeAbove = true;

            if (networkItems && networkItems.length > 0) {
                targetSibling = networkItems[networkItems.length - 1];
                placeAbove = true;
            } else if (quickSettings._bluetooth?.quickSettingsItems?.length > 0) {
                targetSibling = quickSettings._bluetooth.quickSettingsItems[0];
                placeAbove = false;
            } else {
                for (let child of children) {
                    if (child !== toggle && child.iconName &&
                        child.iconName.includes('network-wireless') &&
                        !child.iconName.includes('hotspot')) {
                        targetSibling = child;
                        placeAbove = true;
                        break;
                    }
                }
            }

            if (targetSibling && targetSibling !== toggle) {
                if (placeAbove) {
                    grid.set_child_above_sibling(toggle, targetSibling);
                } else {
                    grid.set_child_below_sibling(toggle, targetSibling);
                }
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    disable() {
        if (this._idleId > 0) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
