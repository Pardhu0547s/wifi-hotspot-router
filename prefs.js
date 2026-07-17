import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

export default class HotspotRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = this.getSettings();
        const config = this._loadSavedConfig();

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
            text: config.ssid
        });
        group.add(ssidRow);

        // 2. Crypto Mode Row
        const cryptoToggleRow = new Adw.SwitchRow({
            title: 'Enable Password Security (WPA2-PSK)',
            active: config.usePassword
        });
        group.add(cryptoToggleRow);

        // 3. Secure Key Password Row
        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Security Key (Minimum 8 Characters)',
            text: config.password
        });
        group.add(passwordRow);

        // Warning Icon suffix for validation
        const warningIcon = new Gtk.Image({
            iconName: 'dialog-warning-symbolic',
            visible: false,
            tooltipText: 'Password must be at least 8 characters'
        });
        warningIcon.add_css_class('error');
        passwordRow.add_suffix(warningIcon);

        cryptoToggleRow.bind_property('active', passwordRow, 'visible', GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE);

        // 4. Client Constraint Row
        const maxClientsAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 32,
            step_increment: 1,
            page_increment: 5,
            value: config.maxClients
        });
        const clientLimitRow = new Adw.SpinRow({
            title: 'Maximum Connected Hardware Stations (Client Limit)',
            adjustment: maxClientsAdjustment
        });
        group.add(clientLimitRow);

        // 5. Wi-Fi Band Selection Row
        let stringList = Gtk.StringList.new(['Auto (Recommended)', '2.4 GHz Only', '5 GHz Only']);
        const bandRow = new Adw.ComboRow({
            title: 'Wi-Fi Band Selection',
            model: stringList
        });
        let initialBandIndex = 0;
        if (config.wifiBand === '2.4') initialBandIndex = 1;
        else if (config.wifiBand === '5') initialBandIndex = 2;
        bandRow.selected = initialBandIndex;
        group.add(bandRow);

        // 6. Support / Donations Row
        const donationsRow = new Adw.ActionRow({
            title: 'Support This Project',
            subtitle: 'Donate or star the repository to support development'
        });
        const linkButton = new Gtk.LinkButton({
            label: 'Donate / Github',
            uri: 'https://github.com/Pardhu0547s/wifi-hotspot-router',
            valign: Gtk.Align.CENTER
        });
        donationsRow.add_suffix(linkButton);
        group.add(donationsRow);

        // Save helper function
        const triggerSave = () => {
            let ssid = ssidRow.get_text() || 'hotspot';
            let usePass = cryptoToggleRow.active;
            let pass = passwordRow.get_text() || '';
            let maxCl = Math.round(maxClientsAdjustment.value);
            let bandVal = 'auto';
            if (bandRow.selected === 1) bandVal = '2.4';
            else if (bandRow.selected === 2) bandVal = '5';
            
            // Password validation indicator (WPA2-PSK requires at least 8 characters)
            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;
            
            // Sync GSettings (except the password key, which is deleted)
            settings.set_string('hotspot-ssid', ssid);
            settings.set_boolean('use-password', usePass);
            settings.set_int('max-clients', maxCl);
            settings.set_string('wifi-band', bandVal);
            
            // Save to secure config file
            this._saveConfig(ssid, usePass, pass, maxCl, bandVal);
        };

        // Listen for changes
        ssidRow.connect('changed', triggerSave);
        cryptoToggleRow.connect('notify::active', triggerSave);
        passwordRow.connect('changed', triggerSave);
        maxClientsAdjustment.connect('value-changed', triggerSave);
        bandRow.connect('notify::selected', triggerSave);

        // Initial validation run on load
        triggerSave();
    }

    _loadSavedConfig() {
        let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
        let config = {
            ssid: 'hotspot',
            usePassword: true,
            password: '',
            maxClients: 10,
            wifiBand: 'auto'
        };

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
                            if (key === 'SSID') config.ssid = value;
                            else if (key === 'USE_PASSWORD') config.usePassword = (value === 'true');
                            else if (key === 'PASSWORD') config.password = value;
                            else if (key === 'MAX_CLIENTS') config.maxClients = parseInt(value, 10) || 10;
                            else if (key === 'WIFI_BAND') config.wifiBand = value;
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
        return config;
    }

    _saveConfig(ssid, usePassword, password, maxClients, wifiBand) {
        let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
        let output = `SSID="${ssid}"
USE_PASSWORD="${usePassword}"
PASSWORD="${password}"
MAX_CLIENTS="${maxClients}"
WIFI_BAND="${wifiBand}"
`;
        try {
            GLib.file_set_contents(path, output);
            GLib.chmod(path, 384); // Secure permissions to 600 (owner read/write only)
        } catch (e) {
            console.error('[HotspotRouter] Error saving config: ' + e.message);
        }
    }
}
