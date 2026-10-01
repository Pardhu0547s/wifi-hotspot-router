import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

export default class HotspotRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = null;
        try {
            settings = this.getSettings();
        } catch (e) {
            console.warn(`[HotspotRouter] GSettings schema not compiled: ${e.message}`);
        }

        const config = this._loadSavedConfig(settings);
        let hasUnsavedChanges = false;

        const page = new Adw.PreferencesPage();
        window.add(page);

        // Save confirmation banner
        const actionGroup = new Adw.PreferencesGroup();
        page.add(actionGroup);

        const saveRow = new Adw.ActionRow({
            title: 'Unsaved Changes',
            subtitle: 'Settings have been modified. Click Save & Apply to restart the hotspot.',
        });

        const saveButton = new Gtk.Button({
            label: 'Save & Apply',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
            sensitive: false,
        });
        saveRow.add_suffix(saveButton);
        actionGroup.add(saveRow);
        saveRow.visible = false;
        actionGroup.visible = false;

        // Group 1: Wireless Network Credentials & Radio
        const coreGroup = new Adw.PreferencesGroup({
            title: 'Wireless Network Settings',
            description: 'Configure hotspot network credentials and radio frequency band',
        });
        page.add(coreGroup);

        const ssidRow = new Adw.EntryRow({
            title: 'Hotspot Name (SSID)',
            text: config.ssid,
        });
        coreGroup.add(ssidRow);

        const ssidWarning = new Gtk.Image({
            iconName: 'dialog-warning-symbolic',
            visible: false,
            tooltipText: 'SSID must be between 1 and 32 characters',
        });
        ssidWarning.add_css_class('error');
        ssidRow.add_suffix(ssidWarning);

        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Security Passphrase',
            text: config.password,
        });
        coreGroup.add(passwordRow);

        const passWarning = new Gtk.Image({
            iconName: 'dialog-warning-symbolic',
            visible: false,
            tooltipText: 'Passphrase must be between 8 and 63 characters',
        });
        passWarning.add_css_class('error');
        passwordRow.add_suffix(passWarning);

        const bandModel = new Gtk.StringList();
        bandModel.append('2.4 GHz (Long Range)');
        bandModel.append('5 GHz (High Speed)');
        const bandRow = new Adw.ComboRow({
            title: 'Wired / Ethernet Hotspot Band',
            subtitle: 'Frequency band when broadcasting from Ethernet or offline. (When repeating Wi-Fi, the band automatically mirrors your Wi-Fi channel)',
            model: bandModel,
            selected: config.band === 'a' ? 1 : 0,
        });
        coreGroup.add(bandRow);

        // Group 2: Advanced Networking
        const advGroup = new Adw.PreferencesGroup({
            title: 'Advanced Network Features',
            description: 'Ad-blocking, power management, and roaming behavior',
        });
        page.add(advGroup);

        const blockAdsRow = new Adw.SwitchRow({
            title: 'Block Ads & Trackers (AdGuard DNS)',
            subtitle: 'Filter advertisements, trackers, and malicious domains on all connected devices',
            active: config.blockAds,
        });
        advGroup.add(blockAdsRow);

        const sleepRow = new Adw.SwitchRow({
            title: 'Prevent System Sleep',
            subtitle: 'Inhibit laptop suspend while devices are connected to the hotspot',
            active: config.inhibitSleep,
        });
        advGroup.add(sleepRow);

        const triggerSave = () => {
            let rawSsid = ssidRow.get_text() || '';
            let ssid = rawSsid.substring(0, 32).replace(/["`$\\]/g, '').trim();
            if (!ssid) ssid = 'hotspot';

            let pass = passwordRow.get_text() || '';
            let band = bandRow.selected === 1 ? 'a' : 'bg';
            let blockAds = blockAdsRow.active;
            let inhibitSleep = sleepRow.active;

            let passValid = pass.length >= 8 && pass.length <= 63;
            passWarning.visible = !passValid;
            if (!passValid) return false;

            let ssidValid = (rawSsid.trim().length > 0 && rawSsid.length <= 32 && !rawSsid.includes('"'));
            ssidWarning.visible = !ssidValid;
            if (!ssidValid) return false;

            const saveSuccess = this._saveConfig(
                ssid, pass, band,
                blockAds, inhibitSleep
            );

            if (!saveSuccess) {
                saveRow.subtitle = 'Error: Failed writing configuration file.';
                saveButton.sensitive = true;
                return false;
            }

            if (settings) {
                try {
                    settings.set_string('hotspot-ssid', ssid);
                    settings.set_string('hotspot-band', band);
                    settings.set_boolean('block-ads', blockAds);
                    settings.set_boolean('inhibit-sleep', inhibitSleep);
                } catch (e) {
                    console.warn(`[HotspotRouter] GSettings update error: ${e.message}`);
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
                    flags: Gio.SubprocessFlags.NONE,
                });
                proc.init(null);
                proc.wait_async(null, null);
            } catch (e) {
                console.error(e);
            }

            try {
                window.add_toast(new Adw.Toast({ title: 'Settings saved and applied successfully' }));
            } catch (e) { }

            return true;
        };

        saveButton.connect('clicked', () => {
            triggerSave();
        });

        const markChanged = () => {
            let pass = passwordRow.get_text() || '';
            let passValid = pass.length >= 8 && pass.length <= 63;
            passWarning.visible = !passValid;

            let ssid = ssidRow.get_text() || '';
            let ssidValid = ssid.trim().length > 0 && ssid.length <= 32 && !ssid.includes('"');
            ssidWarning.visible = !ssidValid;

            hasUnsavedChanges = true;
            actionGroup.visible = true;
            saveRow.visible = true;
            saveRow.subtitle = 'Settings have been modified. Click Save & Apply to restart the hotspot.';
            saveButton.sensitive = passValid && ssidValid;
        };

        ssidRow.connect('changed', markChanged);
        passwordRow.connect('changed', markChanged);
        bandRow.connect('notify::selected', markChanged);
        blockAdsRow.connect('notify::active', markChanged);
        sleepRow.connect('notify::active', markChanged);

        // Group 3: Project Links
        const supportGroup = new Adw.PreferencesGroup({
            title: 'About & Support',
            description: 'Documentation, updates, and open-source repository',
        });
        page.add(supportGroup);

        const supportRow = new Adw.ActionRow({
            title: 'GitHub Repository',
            subtitle: 'Star or report issues on GitHub',
        });
        const starButton = new Gtk.LinkButton({
            label: 'Donate / GitHub',
            uri: 'https://github.com/Pardhu0547s/wifi-hotspot-router',
            valign: Gtk.Align.CENTER,
        });
        supportRow.add_suffix(starButton);
        supportGroup.add(supportRow);

        window.connect('close-request', () => {
            if (hasUnsavedChanges) {
                let pass = passwordRow.get_text() || '';
                let ssid = ssidRow.get_text() || '';
                let passValid = (pass.length >= 8 && pass.length <= 63);
                let ssidValid = (ssid.trim().length > 0 && ssid.length <= 32 && !ssid.includes('"'));
                if (passValid && ssidValid) {
                    triggerSave();
                }
            }
            return false;
        });

        let passInitValid = config.password.length >= 8;
        passWarning.visible = !passInitValid;
    }

    _loadSavedConfig(settings = null) {
        let config = {
            ssid: 'hotspot',
            password: 'hotspotpassword',
            band: 'bg',
            blockAds: false,
            inhibitSleep: true,
        };

        if (settings) {
            try {
                config.ssid = settings.get_string('hotspot-ssid') || config.ssid;
                config.band = settings.get_string('hotspot-band') || config.band;
                config.blockAds = settings.get_boolean('block-ads');
                config.inhibitSleep = settings.get_boolean('inhibit-sleep');
            } catch (e) { }
        }

        let path = GLib.get_user_config_dir() + '/wifi-hotspot.conf';
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                let [success, content] = GLib.file_get_contents(path);
                if (success) {
                    let lines = new TextDecoder('utf-8').decode(content).split('\n');
                    for (let line of lines) {
                        let match = line.match(/^(\w+)\s*=\s*"(.*)"$/);
                        if (match) {
                            let [, key, val] = match;
                            switch (key) {
                                case 'SSID': config.ssid = val; break;
                                case 'PASSWORD': config.password = val; break;
                                case 'BAND': config.band = val; break;
                                case 'BLOCK_ADS': config.blockAds = (val === 'true'); break;
                                case 'DNS_PROFILE': if (val === 'adguard') config.blockAds = true; break;
                                case 'INHIBIT_SLEEP': config.inhibitSleep = (val === 'true'); break;
                            }
                        }
                    }
                }
            } catch (e) { }
        }
        return config;
    }

    _saveConfig(ssid, password, band, blockAds, inhibitSleep) {
        let configDir = GLib.get_user_config_dir();
        let path = configDir + '/wifi-hotspot.conf';
        let output = `SSID="${ssid}"
PASSWORD="${password}"
BAND="${band}"
BLOCK_ADS="${blockAds}"
INHIBIT_SLEEP="${inhibitSleep}"
`;
        try {
            GLib.mkdir_with_parents(configDir, 448);
            GLib.file_set_contents(path, output);
            GLib.chmod(path, 384);
            return true;
        } catch (e) {
            console.error('[HotspotRouter] Failed saving config: ' + e.message);
            return false;
        }
    }
}
