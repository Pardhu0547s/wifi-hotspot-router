import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const HotspotRouterToggle = GObject.registerClass(
class HotspotRouterToggle extends QuickSettings.QuickToggle {
    _init(extension) {
        super._init({
            title: 'Hotspot',
            iconName: 'network-wireless-hotspot-symbolic',
            toggleMode: true,
        });

        this._extension = extension;
        this._settings = extension.getSettings();
        this._timeoutId = 0;

        // User action listener
        this.connect('clicked', () => {
            this._handleToggleEvent(this.checked);
        });

        // Initialize state right away and start the polling state machine
        this._checkHotspotActiveState();
        this._startPollingLoop();
    }

    _handleToggleEvent(shouldActivate) {
        if (!shouldActivate) {
            this._runCommand(['nmcli', 'connection', 'down', 'Hotspot']);
            return;
        }

        let ssid = this._settings.get_string('hotspot-ssid') || 'hotspot';
        let secureMode = this._settings.get_boolean('use-password');
        let clientLimit = this._settings.get_int('max-clients');

        // Modify parameters natively without using 'sudo'
        this._runCommand(['nmcli', 'connection', 'modify', 'Hotspot', 
            '802-11-wireless.ssid', ssid,
            '802-11-wireless.max-clients', clientLimit.toString()
        ]);

        if (secureMode) {
            this._runCommand(['nmcli', 'connection', 'modify', 'Hotspot',
                '802-11-wireless-security.key-mgmt', 'wpa-psk'
            ]);
        } else {
            this._runCommand(['nmcli', 'connection', 'modify', 'Hotspot',
                '802-11-wireless-security.key-mgmt', 'none'
            ]);
        }

        this._runCommand(['nmcli', 'connection', 'up', 'Hotspot']);
    }

    _runCommand(args) {
        try {
            let proc = new Gio.Subprocess({ argv: args, flags: Gio.SubprocessFlags.NONE });
            proc.init(null);
            proc.wait_async(null, null);
        } catch (e) {
            console.error(`[HotspotRouter] Failed executing command: ${e.message}`);
        }
    }

    _checkHotspotActiveState() {
        try {
            let proc = new Gio.Subprocess({
                argv: ['nmcli', '-g', 'NAME,ACTIVE', 'connection', 'show', '--active'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (obj, res) => {
                try {
                    let [success, stdout] = obj.communicate_utf8_finish(res);
                    if (success && stdout) {
                        let active = stdout.split('\n').some(l => l.startsWith('Hotspot:yes'));
                        if (this.checked !== active) {
                            this.checked = active;
                        }
                    }
                } catch (err) {
                    // Fail silently during background state polling updates
                }
            });
        } catch (e) {
            // Fail silently
        }
    }

    _startPollingLoop() {
        // Fix: Safely clear any pre-existing timeout source before allocating a new one
        if (this._timeoutId > 0) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            this._checkHotspotActiveState();
            return GLib.SOURCE_CONTINUE; // Keeps the loop alive
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
