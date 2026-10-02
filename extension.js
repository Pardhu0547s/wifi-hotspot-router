import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HotspotIndicator, placeToggle} from './shell/indicator.js';

export default class HotspotRouterExtension extends Extension {
    enable() {
        this._indicator = new HotspotIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        if (!placeToggle(this._indicator.hotspotToggle)) {
            this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idleId = 0;
                placeToggle(this._indicator.hotspotToggle);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    disable() {
        if (this._idleId) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }
        this._indicator.destroy();
        this._indicator = null;
    }
}
