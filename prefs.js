import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

export default class HotspotRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings;
        try {
            settings = this.getSettings();
        } catch (e) {
            console.error(`[HotspotRouter] Failed to load GSettings schema. Run setup.sh to recompile: ${e.message}`);
            settings = null;
        }
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
        actionGroup.visible = false;

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

        // SSID validation warning
        const ssidWarning = new Gtk.Image({
            iconName: 'dialog-warning-symbolic',
            visible: false,
            tooltipText: 'SSID must be 1-32 characters, no quotes'
        });
        ssidWarning.add_css_class('error');
        ssidRow.add_suffix(ssidWarning);

        const cryptoToggleRow = new Adw.SwitchRow({
            title: 'Enable Password Security',
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

        const secModel = new Gtk.StringList();
        secModel.append('WPA2-PSK (Standard / Maximum Compatibility)');
        secModel.append('WPA2 / WPA3-SAE Mixed Mode (Recommended)');
        secModel.append('WPA3-Personal Only (SAE)');
        const secProfiles = ['wpa2', 'wpa3-mixed', 'wpa3'];
        let initialSecIdx = secProfiles.indexOf(config.securityMode);
        if (initialSecIdx < 0) initialSecIdx = 0;
        const secRow = new Adw.ComboRow({
            title: 'Security Encryption Protocol',
            subtitle: 'Select WPA3 for enhanced security against password guessing on supported devices',
            model: secModel,
            selected: initialSecIdx
        });
        group.add(secRow);

        cryptoToggleRow.bind_property('active', passwordRow, 'visible', GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE);
        cryptoToggleRow.bind_property('active', secRow, 'visible', GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE);

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
            title: 'Advanced & Power Policy Configuration',
            description: 'Tune DNS filtering profiles, network isolation, and sleep management'
        });
        page.add(advGroup);

        const dnsModel = new Gtk.StringList();
        dnsModel.append('System Default (Inherit Upstream Network DNS)');
        dnsModel.append('Cloudflare Privacy (1.1.1.1)');
        dnsModel.append('AdGuard Family & Ad-Blocking (94.140.14.14)');
        dnsModel.append('Quad9 Secure (9.9.9.9)');
        dnsModel.append('Google Public DNS (8.8.8.8)');
        const dnsProfiles = ['system', 'cloudflare', 'adguard', 'quad9', 'google'];
        let initialDnsIdx = dnsProfiles.indexOf(config.dnsProfile);
        if (initialDnsIdx < 0) initialDnsIdx = 0;
        const dnsRow = new Adw.ComboRow({
            title: 'Upstream DNS & Filtering Profile',
            subtitle: 'Assign custom DNS resolving or network-wide ad blocking to connected stations',
            model: dnsModel,
            selected: initialDnsIdx
        });
        advGroup.add(dnsRow);

        const isolateRow = new Adw.SwitchRow({
            title: 'Isolate Connected Clients (AP Isolation)',
            subtitle: 'Prevent connected Wi-Fi devices from seeing or communicating with each other directly',
            active: config.isolateClients
        });
        advGroup.add(isolateRow);

        const idleModel = new Gtk.StringList();
        idleModel.append('Disabled (Always Stay On)');
        idleModel.append('5 Minutes');
        idleModel.append('10 Minutes');
        idleModel.append('15 Minutes');
        idleModel.append('30 Minutes');
        const idleTimeouts = [0, 5, 10, 15, 30];
        let initialIdleIdx = idleTimeouts.indexOf(config.idleTimeout);
        if (initialIdleIdx < 0) initialIdleIdx = 0;
        const idleTimeoutRow = new Adw.ComboRow({
            title: 'Auto-Turn Off When Idle',
            subtitle: 'Automatically disable hotspot after specified period when zero devices are connected',
            model: idleModel,
            selected: initialIdleIdx
        });
        advGroup.add(idleTimeoutRow);

        const inhibitSleepRow = new Adw.SwitchRow({
            title: 'Prevent System Sleep While Active',
            subtitle: 'Inhibit laptop suspend/sleep when hardware stations are actively connected',
            active: config.inhibitSleep
        });
        advGroup.add(inhibitSleepRow);

        const triggerSave = () => {
            let ssid = (ssidRow.get_text() || 'hotspot').substring(0, 32).replace(/"/g, '');
            if (!ssid) ssid = 'hotspot';
            let usePass = cryptoToggleRow.active;
            let pass = passwordRow.get_text() || '';
            let maxCl = Math.round(maxClientsAdjustment.value);
            let band = bandRow.selected === 1 ? 'a' : 'bg';
            let securityMode = secProfiles[secRow.selected] || 'wpa2';
            let dnsProfile = dnsProfiles[dnsRow.selected] || 'system';
            let isolateClients = isolateRow.active;
            let idleTimeout = idleTimeouts[idleTimeoutRow.selected] || 0;
            let inhibitSleep = inhibitSleepRow.active;

            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;
            if (!passValid) return;

            // Save the config file FIRST — this is the primary source of truth
            const saveSuccess = this._saveConfig(ssid, usePass, pass, maxCl, band, dnsProfile, securityMode, isolateClients, idleTimeout, inhibitSleep);

            if (!saveSuccess) {
                // Show error feedback to user
                saveRow.subtitle = 'Error: Failed to save configuration file. Check permissions.';
                saveButton.sensitive = true;
                return;
            }

            // GSettings is secondary — wrap in try-catch so a stale compiled schema
            // doesn't prevent saving the config or restarting the hotspot
            if (settings) {
                try {
                    settings.set_string('hotspot-ssid', ssid);
                    settings.set_boolean('use-password', usePass);
                    settings.set_int('max-clients', maxCl);
                    settings.set_string('hotspot-band', band);
                    settings.set_string('security-mode', securityMode);
                    settings.set_string('dns-profile', dnsProfile);
                    settings.set_boolean('isolate-clients', isolateClients);
                    settings.set_int('idle-timeout', idleTimeout);
                    settings.set_boolean('inhibit-sleep', inhibitSleep);
                } catch (e) {
                    console.error(`[HotspotRouter] GSettings write error (run setup.sh to recompile schemas): ${e.message}`);
                }
            }

            hasUnsavedChanges = false;
            saveRow.visible = false;
            actionGroup.visible = false;
            saveButton.sensitive = false;

            try {
                let username = GLib.get_user_name();
                let proc = new Gio.Subprocess({
                    argv: ['systemctl', 'try-restart', `wifi-hotspot@${username}.service`],
                    flags: Gio.SubprocessFlags.NONE
                });
                proc.wait_async(null, null);
            } catch (e) {
                console.error(`[HotspotRouter] Error restarting service: ${e.message || e}`);
            }
        };

        saveButton.connect('clicked', triggerSave);

        const markChanged = () => {
            let usePass = cryptoToggleRow.active;
            let pass = passwordRow.get_text() || '';
            let passValid = !usePass || (pass.length >= 8);
            warningIcon.visible = !passValid;

            // SSID validation
            let ssid = ssidRow.get_text() || '';
            let ssidValid = ssid.length > 0 && ssid.length <= 32 && !ssid.includes('"');
            ssidWarning.visible = !ssidValid;

            hasUnsavedChanges = true;
            actionGroup.visible = true;
            saveRow.visible = true;
            saveRow.subtitle = 'You have modified settings. Save to apply them immediately.';
            saveButton.sensitive = passValid && ssidValid;
        };

        ssidRow.connect('changed', markChanged);
        cryptoToggleRow.connect('notify::active', markChanged);
        passwordRow.connect('changed', markChanged);
        maxClientsAdjustment.connect('value-changed', markChanged);
        bandRow.connect('notify::selected', markChanged);
        secRow.connect('notify::selected', markChanged);
        dnsRow.connect('notify::selected', markChanged);
        isolateRow.connect('notify::active', markChanged);
        idleTimeoutRow.connect('notify::selected', markChanged);
        inhibitSleepRow.connect('notify::active', markChanged);

        const donationsGroup = new Adw.PreferencesGroup({
            title: 'Support & Contributions',
            description: 'Support ongoing open-source development and maintenance'
        });
        page.add(donationsGroup);

        const donationsRow = new Adw.ActionRow({
            title: 'Support This Project',
            subtitle: 'Donate or star the repository on GitHub to support development'
        });
        const linkButton = new Gtk.LinkButton({
            label: 'Donate / GitHub',
            uri: 'https://github.com/Pardhu0547s/wifi-hotspot-router',
            valign: Gtk.Align.CENTER
        });
        donationsRow.add_suffix(linkButton);
        donationsGroup.add(donationsRow);

        window.connect('close-request', () => {
            if (hasUnsavedChanges) {
                let usePass = cryptoToggleRow.active;
                let pass = passwordRow.get_text() || '';
                let passValid = !usePass || (pass.length >= 8);
                let ssid = ssidRow.get_text() || '';
                let ssidValid = ssid.length > 0 && ssid.length <= 32 && !ssid.includes('"');
                if (passValid && ssidValid) {
                    triggerSave();
                }
            }
            return false;
        });

        let passInitValid = !config.usePassword || (config.password.length >= 8);
        warningIcon.visible = !passInitValid;
    }

    _loadSavedConfig() {
        let path = GLib.get_user_config_dir() + '/wifi-hotspot.conf';
        let config = {
            ssid: 'hotspot',
            usePassword: true,
            password: '',
            maxClients: 10,
            band: 'bg',
            dnsProfile: 'system',
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

    _saveConfig(ssid, usePassword, password, maxClients, band, dnsProfile = 'system', securityMode = 'wpa2', isolateClients = false, idleTimeout = 0, inhibitSleep = false) {
        let path = GLib.get_user_config_dir() + '/wifi-hotspot.conf';
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
            GLib.chmod(path, 384); // 0600 — owner read/write only
            return true;
        } catch (e) {
            console.error('[HotspotRouter] Error saving config: ' + e.message);
            return false;
        }
    }
}
