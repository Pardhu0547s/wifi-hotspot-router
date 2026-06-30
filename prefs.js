import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

export default class HotspotRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Network Parameters Configuration',
            description: 'Configure your custom development local subnet environment securely'
        });
        page.add(group);

        // 1. SSID Row
        const ssidRow = new Adw.EntryRow({
            title: 'Hotspot Name (SSID)',
            text: settings.get_string('hotspot-ssid')
        });
        settings.bind('hotspot-ssid', ssidRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(ssidRow);

        // 2. Crypto Mode Row
        const cryptoToggleRow = new Adw.SwitchRow({
            title: 'Enable Password Security (WPA2-PSK)',
            active: settings.get_boolean('use-password')
        });
        settings.bind('use-password', cryptoToggleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(cryptoToggleRow);

        // 3. Secure Key Password Row
        const passwordRow = new Adw.EntryRow({
            title: 'Security Key (Minimum 8 Characters)',
            secret: true
        });
        group.add(passwordRow);

        // Fetch current secure key from NetworkManager dynamically to show in entry
        this._getStoredPassword(passwordRow);

        // Save password changes directly to NetworkManager secure store on change
        passwordRow.connect('changed', () => {
            let txt = passwordRow.get_text();
            if (txt.length >= 8) {
                this._runCommand(['nmcli', 'connection', 'modify', 'Hotspot', '802-11-wireless-security.psk', txt]);
            }
        });

        cryptoToggleRow.bind_property('active', passwordRow, 'visible', GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE);

        // 4. Client Constraint Row
        const maxClientsAdjustment = Gtk.Adjustment.new(
            settings.get_int('max-clients'), 1, 32, 1, 5, 0
        );
        const clientLimitRow = new Adw.SpinRow({
            title: 'Maximum Connected Hardware Stations (Client Limit)',
            adjustment: maxClientsAdjustment
        });
        settings.bind('max-clients', clientLimitRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(clientLimitRow);
    }

    _getStoredPassword(entryRow) {
        try {
            let proc = new Gio.Subprocess({
                argv: ['nmcli', '-s', '-g', '802-11-wireless-security.psk', 'connection', 'show', 'Hotspot'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (obj, res) => {
                try {
                    let [success, stdout] = obj.communicate_utf8_finish(res);
                    if (success && stdout) {
                        let pass = stdout.trim();
                        if (pass && pass !== 'none') entryRow.set_text(pass);
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }

    _runCommand(args) {
        try {
            let proc = new Gio.Subprocess({ argv: args, flags: Gio.SubprocessFlags.NONE });
            proc.init(null);
            proc.wait_async(null, null);
        } catch (e) {}
    }
}
