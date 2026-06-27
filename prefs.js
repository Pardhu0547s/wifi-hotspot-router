import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HotspotRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create Page
        const page = new Adw.PreferencesPage({
            title: _('Hotspot Settings'),
            icon_name: 'network-wireless-hotspot-symbolic',
        });

        // Create Group
        const group = new Adw.PreferencesGroup({
            title: _('Configuration'),
            description: _('Configure network name, security, and client limits.'),
        });
        page.add(group);
        window.add(page);

        // Network Name (SSID)
        const ssidRow = new Adw.EntryRow({
            title: _('Hotspot Name (SSID)'),
            text: settings.get_string('hotspot-ssid') || 'Fedora',
        });
        settings.bind('hotspot-ssid', ssidRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(ssidRow);

        // Security Toggle (Use Password)
        const usePasswordRow = new Adw.SwitchRow({
            title: _('Require Password'),
            active: settings.get_boolean('use-password'),
        });
        settings.bind('use-password', usePasswordRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(usePasswordRow);

        // Password Entry
        const passwordRow = new Adw.EntryRow({
            title: _('Password'),
            text: settings.get_string('hotspot-password') || '12345678',
        });
        
        // Hide password row if security is disabled
        passwordRow.visible = usePasswordRow.active;
        usePasswordRow.connect('notify::active', () => {
            passwordRow.visible = usePasswordRow.active;
        });

        settings.bind('hotspot-password', passwordRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(passwordRow);

        // Max Connected Devices (Max Clients)
        const adjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('max-clients'),
        });
        
        const maxClientsRow = new Adw.SpinRow({
            title: _('Max Connected Devices (Set to 0 for unlimited)'),
            adjustment: adjustment,
        });
        settings.bind('max-clients', maxClientsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(maxClientsRow);
    }
}
