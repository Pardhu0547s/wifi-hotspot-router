import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {isValidPassphrase, isValidSsid, loadOrCreateConfig, saveConfig} from './lib/config.js';

export default class HotspotRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const config = loadOrCreateConfig();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const saveGroup = new Adw.PreferencesGroup({visible: false});
        const saveButton = new Gtk.Button({
            label: 'Save & Apply',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
            sensitive: false,
        });
        const saveRow = new Adw.ActionRow({title: 'Unsaved Changes'});
        saveRow.add_suffix(saveButton);
        saveGroup.add(saveRow);
        page.add(saveGroup);

        const networkGroup = new Adw.PreferencesGroup({title: 'Wireless Network Settings'});
        page.add(networkGroup);

        const ssidRow = new Adw.EntryRow({title: 'Hotspot Name (SSID)', text: config.ssid});
        const ssidWarning = this._createWarningIcon('SSID must be between 1 and 32 characters');
        ssidRow.add_suffix(ssidWarning);
        networkGroup.add(ssidRow);

        const passwordRow = new Adw.PasswordEntryRow({title: 'Security Passphrase', text: config.password});
        const passphraseWarning = this._createWarningIcon('Passphrase must be between 8 and 63 characters');
        passwordRow.add_suffix(passphraseWarning);
        networkGroup.add(passwordRow);

        const bandModel = new Gtk.StringList();
        bandModel.append('2.4 GHz (Long Range)');
        bandModel.append('5 GHz (High Speed)');
        const bandRow = new Adw.ComboRow({
            title: 'Wired / Ethernet Hotspot Band',
            model: bandModel,
            selected: config.band === 'a' ? 1 : 0,
        });
        networkGroup.add(bandRow);

        // Shows the warning icons and returns the form values if all are valid.
        const validateForm = () => {
            const form = {
                ssid: ssidRow.text.trim(),
                password: passwordRow.text,
                band: bandRow.selected === 1 ? 'a' : 'bg',
            };
            const ssidValid = isValidSsid(form.ssid);
            const passphraseValid = isValidPassphrase(form.password);
            ssidWarning.visible = !ssidValid;
            passphraseWarning.visible = !passphraseValid;
            return ssidValid && passphraseValid ? form : null;
        };

        const onFormChanged = () => {
            saveGroup.visible = true;
            saveButton.sensitive = validateForm() !== null;
        };
        ssidRow.connect('changed', onFormChanged);
        passwordRow.connect('changed', onFormChanged);
        bandRow.connect('notify::selected', onFormChanged);

        saveButton.connect('clicked', () => {
            const form = validateForm();
            if (!form)
                return;

            try {
                saveConfig(form);
            } catch (e) {
                console.error(`Failed to save the hotspot configuration: ${e.message}`);
                window.add_toast(new Adw.Toast({title: 'Could not save settings'}));
                return;
            }

            // The extension listens to these keys to refresh its menu.
            settings.set_string('hotspot-ssid', form.ssid);
            settings.set_string('hotspot-band', form.band);

            saveGroup.visible = false;
            saveButton.sensitive = false;
            this._restartService();
            window.add_toast(new Adw.Toast({title: 'Settings saved and applied successfully'}));
        });

        const aboutGroup = new Adw.PreferencesGroup({title: 'About & Support'});
        page.add(aboutGroup);

        const repositoryRow = new Adw.ActionRow({title: 'GitHub Repository'});
        repositoryRow.add_suffix(new Gtk.LinkButton({
            label: 'Open on GitHub',
            uri: this.metadata.url,
            valign: Gtk.Align.CENTER,
        }));
        aboutGroup.add(repositoryRow);

        validateForm();
    }

    _createWarningIcon(tooltip) {
        const icon = new Gtk.Image({
            iconName: 'dialog-warning-symbolic',
            visible: false,
            tooltipText: tooltip,
        });
        icon.add_css_class('error');
        return icon;
    }

    _restartService() {
        const unitName = `wifi-hotspot@${GLib.get_user_name()}.service`;
        try {
            Gio.Subprocess.new(['systemctl', 'try-restart', unitName], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.error(`Could not restart ${unitName}: ${e.message}`);
        }
    }
}
