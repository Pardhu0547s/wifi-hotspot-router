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
        
        let hasUnsavedChanges = false;

        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Action Header Group ---
        const actionGroup = new Adw.PreferencesGroup();
        page.add(actionGroup);

        const saveRow = new Adw.ActionRow({
            title: 'Unsaved Changes',
            subtitle: 'You have modified settings. Save to apply them immediately.'
        });
        
        const saveButton = new Gtk.Button({
            label: 'Save & Restart',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
            sensitive: false
        });
        saveRow.add_suffix(saveButton);
        actionGroup.add(saveRow);
        saveRow.visible = false; // Hide until there are changes

        // --- Network Config Group ---
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
            
            // Password validation indicator (WPA2-PSK requires at least 8 characters)
            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;
            if (!passValid) return; // Prevent save if invalid
            
            // Sync GSettings (except the password key, which is deleted)
            settings.set_string('hotspot-ssid', ssid);
            settings.set_boolean('use-password', usePass);
            settings.set_int('max-clients', maxCl);
            
            // Save to secure config file
            this._saveConfig(ssid, usePass, pass, maxCl);
            
            hasUnsavedChanges = false;
            saveRow.visible = false;
            saveButton.sensitive = false;

            // Restart hotspot if active
            try {
                let username = GLib.get_user_name();
                let proc = new Gio.Subprocess({
                    argv: ['systemctl', 'try-restart', `wifi-hotspot@${username}.service`],
                    flags: Gio.SubprocessFlags.NONE
                });
                proc.init(null);
                proc.wait_async(null, null);
            } catch (e) {
                console.error(e);
            }
        };

        saveButton.connect('clicked', triggerSave);

        // Mark as changed logic
        const markChanged = () => {
            let usePass = cryptoToggleRow.active;
            let pass = passwordRow.get_text() || '';
            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;
            
            hasUnsavedChanges = true;
            saveRow.visible = true;
            saveButton.sensitive = passValid; // Only allow save if valid
        };

        // Listen for changes
        ssidRow.connect('changed', markChanged);
        cryptoToggleRow.connect('notify::active', markChanged);
        passwordRow.connect('changed', markChanged);
        maxClientsAdjustment.connect('value-changed', markChanged);

        // Handle window close request
        window.connect('close-request', (win) => {
            if (hasUnsavedChanges) {
                let dialog = new Adw.MessageDialog({
                    heading: 'Unsaved Changes',
                    body: 'You have modified your hotspot settings. Do you want to save them and restart the hotspot, or discard the changes?',
                    transient_for: win
                });
                dialog.add_response('discard', 'Discard');
                dialog.add_response('save', 'Save & Apply');
                dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
                dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
                
                dialog.connect('response', (dlg, response) => {
                    if (response === 'save') {
                        triggerSave();
                    }
                    hasUnsavedChanges = false; // Reset so next close request goes through
                    win.close(); // Programmatically close now
                });
                
                dialog.present();
                return true; // Block closing
            }
            return false; // Allow closing
        });

        // Initial validation run on load (without triggering save)
        let passInitValid = !config.usePassword || (config.password.length >= 8);
        warningIcon.visible = !passInitValid;
    }

    _loadSavedConfig() {
        let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
        let config = {
            ssid: 'hotspot',
            usePassword: true,
            password: '',
            maxClients: 10
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
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
        return config;
    }

    _saveConfig(ssid, usePassword, password, maxClients) {
        let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
        let output = `SSID="${ssid}"
USE_PASSWORD="${usePassword}"
PASSWORD="${password}"
MAX_CLIENTS="${maxClients}"
`;
        try {
            GLib.file_set_contents(path, output);
            GLib.chmod(path, 384); // Secure permissions to 600 (owner read/write only)
        } catch (e) {
            console.error('[HotspotRouter] Error saving config: ' + e.message);
        }
    }
}
