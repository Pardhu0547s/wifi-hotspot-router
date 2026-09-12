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
        saveRow.visible = false;

        const group = new Adw.PreferencesGroup({
            title: 'Network Parameters Configuration',
            description: 'Configure your custom development local subnet environment securely'
        });
        page.add(group);

        const ssidRow = new Adw.EntryRow({
            title: 'Hotspot Name (SSID)',
            text: config.ssid
        });
        group.add(ssidRow);

        const cryptoToggleRow = new Adw.SwitchRow({
            title: 'Enable Password Security (WPA2-PSK)',
            active: config.usePassword
        });
        group.add(cryptoToggleRow);

        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Security Key (Minimum 8 Characters)',
            text: config.password
        });
        group.add(passwordRow);

        const warningIcon = new Gtk.Image({
            iconName: 'dialog-warning-symbolic',
            visible: false,
            tooltipText: 'Password must be at least 8 characters'
        });
        warningIcon.add_css_class('error');
        passwordRow.add_suffix(warningIcon);

        cryptoToggleRow.bind_property('active', passwordRow, 'visible', GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE);

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

        const bandModel = new Gtk.StringList();
        bandModel.append('2.4 GHz');
        bandModel.append('5 GHz');
        const bandRow = new Adw.ComboRow({
            title: 'Wi-Fi Band',
            subtitle: 'Frequency band for Ethernet or offline sharing. (When repeating active Wi-Fi, the band matches your Wi-Fi network)',
            model: bandModel,
            selected: config.band === 'a' ? 1 : 0
        });
        group.add(bandRow);


        const advGroup = new Adw.PreferencesGroup({
            title: 'Advanced Router and Power Settings',
            description: 'Optional performance, privacy, and power management options'
        });
        page.add(advGroup);

        const dnsModel = new Gtk.StringList();
        dnsModel.append('Cloudflare 1.1.1.1 (Fastest Default)');
        dnsModel.append('AdGuard DNS (Block Ads and Trackers)');
        dnsModel.append('Quad9 9.9.9.9 (Malware and Phishing Filter)');
        dnsModel.append('Google DNS 8.8.8.8');
        const dnsProfiles = ['cloudflare', 'adguard', 'quad9', 'google'];
        let initialDnsIdx = dnsProfiles.indexOf(config.dnsProfile);
        if (initialDnsIdx < 0) initialDnsIdx = 0;
        const dnsRow = new Adw.ComboRow({
            title: 'DNS and Ad-Blocking',
            subtitle: 'Upstream DNS provider and privacy content filtering for connected devices',
            model: dnsModel,
            selected: initialDnsIdx
        });
        advGroup.add(dnsRow);

        const secModel = new Gtk.StringList();
        secModel.append('WPA2-PSK (Standard / Maximum Compatibility)');
        secModel.append('WPA2 / WPA3-SAE Mixed (Enhanced Security)');
        const secRow = new Adw.ComboRow({
            title: 'Security Encryption Mode',
            subtitle: 'WPA3 provides advanced protection against password cracking for modern devices',
            model: secModel,
            selected: config.securityMode === 'wpa3-mixed' ? 1 : 0
        });
        advGroup.add(secRow);

        const isolateRow = new Adw.SwitchRow({
            title: 'Client Isolation (Guest Mode)',
            subtitle: 'Prevent connected devices from communicating directly with each other or host services',
            active: config.isolateClients
        });
        advGroup.add(isolateRow);

        const idleModel = new Gtk.StringList();
        idleModel.append('Disabled (Always On)');
        idleModel.append('10 Minutes');
        idleModel.append('15 Minutes');
        idleModel.append('30 Minutes');
        let initialIdleIdx = config.idleTimeout === 10 ? 1 : (config.idleTimeout === 15 ? 2 : (config.idleTimeout === 30 ? 3 : 0));
        const idleRow = new Adw.ComboRow({
            title: 'Auto-Turn Off When Idle',
            subtitle: 'Automatically disable hotspot when no devices are connected to save battery',
            model: idleModel,
            selected: initialIdleIdx
        });
        advGroup.add(idleRow);

        const sleepRow = new Adw.SwitchRow({
            title: 'Prevent Laptop Sleep While Active',
            subtitle: 'Keep system awake while clients are actively connected to prevent disconnections',
            active: config.inhibitSleep
        });
        advGroup.add(sleepRow);

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
        advGroup.add(donationsRow);

        const triggerSave = () => {
            let ssid = ssidRow.get_text() || 'hotspot';
            let usePass = cryptoToggleRow.active;
            let pass = passwordRow.get_text() || '';
            let maxCl = Math.round(maxClientsAdjustment.value);
            let band = bandRow.selected === 1 ? 'a' : 'bg';
            let dnsProfile = dnsProfiles[dnsRow.selected] || 'cloudflare';
            let securityMode = secRow.selected === 1 ? 'wpa3-mixed' : 'wpa2';
            let isolateClients = isolateRow.active;
            const idleValues = [0, 10, 15, 30];
            let idleTimeout = idleValues[idleRow.selected] || 0;
            let inhibitSleep = sleepRow.active;

            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;
            if (!passValid) return;

            settings.set_string('hotspot-ssid', ssid);
            settings.set_boolean('use-password', usePass);
            settings.set_int('max-clients', maxCl);
            settings.set_string('hotspot-band', band);
            settings.set_string('dns-profile', dnsProfile);
            settings.set_string('security-mode', securityMode);
            settings.set_boolean('isolate-clients', isolateClients);
            settings.set_int('idle-timeout', idleTimeout);
            settings.set_boolean('inhibit-sleep', inhibitSleep);

            this._saveConfig(ssid, usePass, pass, maxCl, band, dnsProfile, securityMode, isolateClients, idleTimeout, inhibitSleep);

            hasUnsavedChanges = false;
            saveRow.visible = false;
            saveButton.sensitive = false;

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

        const markChanged = () => {
            let usePass = cryptoToggleRow.active;
            let pass = passwordRow.get_text() || '';
            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;

            hasUnsavedChanges = true;
            saveRow.visible = true;
            saveButton.sensitive = passValid;
        };

        ssidRow.connect('changed', markChanged);
        cryptoToggleRow.connect('notify::active', markChanged);
        passwordRow.connect('changed', markChanged);
        maxClientsAdjustment.connect('value-changed', markChanged);
        bandRow.connect('notify::selected', markChanged);
        dnsRow.connect('notify::selected', markChanged);
        secRow.connect('notify::selected', markChanged);
        isolateRow.connect('notify::active', markChanged);
        idleRow.connect('notify::selected', markChanged);
        sleepRow.connect('notify::active', markChanged);

        window.connect('close-request', () => {
            if (hasUnsavedChanges) {
                let usePass = cryptoToggleRow.active;
                let pass = passwordRow.get_text() || '';
                let passValid = !usePass || (pass.length >= 8);
                if (passValid) {
                    triggerSave();
                }
            }
            return false;
        });

        let passInitValid = !config.usePassword || (config.password.length >= 8);
        warningIcon.visible = !passInitValid;
    }

    _loadSavedConfig() {
        let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
        let config = {
            ssid: 'hotspot',
            usePassword: true,
            password: '',
            maxClients: 10,
            band: 'bg',
            dnsProfile: 'cloudflare',
            securityMode: 'wpa2',
            isolateClients: false,
            idleTimeout: 0,
            inhibitSleep: false
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
                            else if (key === 'BAND') config.band = value;
                            else if (key === 'DNS_PROFILE') config.dnsProfile = value;
                            else if (key === 'SECURITY_MODE') config.securityMode = value;
                            else if (key === 'ISOLATE_CLIENTS') config.isolateClients = (value === 'true');
                            else if (key === 'IDLE_TIMEOUT') config.idleTimeout = parseInt(value, 10) || 0;
                            else if (key === 'INHIBIT_SLEEP') config.inhibitSleep = (value === 'true');
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
        return config;
    }

    _saveConfig(ssid, usePassword, password, maxClients, band, dnsProfile = 'cloudflare', securityMode = 'wpa2', isolateClients = false, idleTimeout = 0, inhibitSleep = false) {
        let path = GLib.get_home_dir() + '/.config/wifi-hotspot.conf';
        let output = `SSID="${ssid}"
USE_PASSWORD="${usePassword}"
PASSWORD="${password}"
MAX_CLIENTS="${maxClients}"
BAND="${band}"
DNS_PROFILE="${dnsProfile}"
SECURITY_MODE="${securityMode}"
ISOLATE_CLIENTS="${isolateClients}"
IDLE_TIMEOUT="${idleTimeout}"
INHIBIT_SLEEP="${inhibitSleep}"
`;
        try {
            GLib.file_set_contents(path, output);
            GLib.chmod(path, 384);
        } catch (e) {
            console.error('[HotspotRouter] Error saving config: ' + e.message);
        }
    }
}
