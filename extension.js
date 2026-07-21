import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const HotspotRouterToggle = GObject.registerClass(
class HotspotRouterToggle extends QuickSettings.QuickMenuToggle {
    _init(extension) {
        super._init({
            title: 'Hotspot',
            iconName: 'network-wireless-hotspot-symbolic',
            toggleMode: true,
        });

        this._extension = extension;
        this._timeoutId = 0;
        
        // Setup Menu Header
        this.menu.setHeader('network-wireless-hotspot-symbolic', 'Hotspot Devices', 'Manage connected clients');

        // Connected Devices Section
        this._connectedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._connectedSection);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Blocked Devices Section
        this._blockedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._blockedSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let settingsItem = new PopupMenu.PopupMenuItem('Extension Settings');
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);

        // User action listener for the main toggle
        this.connect('clicked', () => {
            this._handleToggleEvent(this.checked);
        });

        // Initialize state right away and start the polling state machine
        this._checkHotspotActiveState();
        this._startPollingLoop();
        
        // Update menu when opened
        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._updateDeviceLists();
            }
        });
    }

    _handleToggleEvent(shouldActivate) {
        let username = GLib.get_user_name();
        let serviceName = `wifi-hotspot@${username}.service`;
        let args = shouldActivate 
            ? ['systemctl', 'start', serviceName] 
            : ['systemctl', 'stop', serviceName];
        this._runCommand(args);
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
                        // Command output unavailable, ignore gracefully
                    }
                });
            } else {
                proc.wait_async(null, null);
            }
        } catch (e) {
            console.error(`[HotspotRouter] Failed executing command: ${e.message}`);
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
                    let active = success && stdout && stdout.trim() === 'active';
                    if (this.checked !== active) {
                        this.checked = active;
                    }
                } catch (err) {
                    // Service state check failed, will retry on next poll
                }
            });
        } catch (e) {
            // systemctl not available or service not installed
        }
    }

    _updateDeviceLists() {
        let username = GLib.get_user_name();
        
        // Fetch Connected Clients
        this._runCommand(['sudo', '/usr/local/bin/manage_hotspot_clients', 'list', '', username], (success, stdout) => {
            this._connectedSection.removeAll();
            
            let header = new PopupMenu.PopupMenuItem('Connected Devices', { reactive: false });
            header.label.add_style_class_name('bold');
            this._connectedSection.addMenuItem(header);
            
            if (success && stdout && stdout.trim()) {
                let lines = stdout.trim().split('\n');
                for (let line of lines) {
                    if (!line) continue;
                    let parts = line.split('|');
                    let mac = parts[0];
                    let hostname = parts.length > 1 ? parts[1] : mac;
                    
                    let item = new PopupMenu.PopupMenuItem(hostname);
                    
                    let blockBtn = new St.Button({
                        style_class: 'button',
                        child: new St.Label({ text: 'Block' })
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
        });
        
        // Fetch Blocked Clients
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
                        child: new St.Label({ text: 'Unblock' })
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
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._timeoutId > 0) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        super.destroy();
    }
});

const HotspotRouterIndicator = GObject.registerClass(
class HotspotRouterIndicator extends QuickSettings.SystemIndicator {
    _init(extension) {
        super._init();
        this._extension = extension;
        
        // Create the Quick Settings Toggle button
        this._toggle = new HotspotRouterToggle(extension);
        
        // Add to quick settings items
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
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
