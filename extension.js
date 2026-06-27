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
            this._executeToggleState(this.checked);
        });

        // Initialize state right away and start the polling state machine
        this._checkHotspotActiveState();
        this._startPollingLoop();
    }

    _executeToggleState(shouldActivate) {
        if (shouldActivate) {
            let ssid = this._settings.get_string('hotspot-ssid') || 'Fedora';
            let usePassword = this._settings.get_boolean('use-password');
            let password = usePassword ? (this._settings.get_string('hotspot-password') || '12345678') : 'NONE';
            let maxClients = this._settings.get_int('max-clients').toString();

            let args = ['sudo', '/usr/local/bin/start_hotspot', ssid, password, maxClients];
            try {
                let proc = Gio.Subprocess.new(args, Gio.SubprocessFlags.NONE);
                proc.wait_async(null, null);
            } catch (e) {
                console.error(`[HotspotRouter] Failed executing start: ${e.message}`);
            }
        } else {
            let args = ['sudo', '/usr/local/bin/stop_hotspot'];
            try {
                let proc = Gio.Subprocess.new(args, Gio.SubprocessFlags.NONE);
                proc.wait_async(null, null);
            } catch (e) {
                console.error(`[HotspotRouter] Failed executing stop: ${e.message}`);
            }
        }
    }

    _checkHotspotActiveState() {
        try {
            // Asynchronously check if the virtual interface ap0 exists
            let proc = Gio.Subprocess.new(
                ['ip', 'link', 'show', 'ap0'],
                Gio.SubprocessFlags.STDOUT_PIPE
            );
            
            proc.communicate_utf8_async(null, null, (obj, res) => {
                try {
                    let [success, stdout, stderr] = obj.communicate_utf8_finish(res);
                    let isActive = success && stdout && stdout.includes('ap0');
                    if (this.checked !== isActive) {
                        this.checked = isActive;
                    }
                } catch (err) {
                    // Fail silently during background state polling updates
                }
            });
        } catch (e) {
            // Fail silently if process initialization hits an unexpected barrier
        }
    }

    _startPollingLoop() {
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
