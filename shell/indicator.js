import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {HotspotToggle} from './hotspotToggle.js';

export const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends QuickSettings.SystemIndicator {
    constructor(extension) {
        super();

        this.hotspotToggle = new HotspotToggle(extension);
        this.quickSettingsItems.push(this.hotspotToggle);
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export function placeToggle(toggle) {
    const quickSettings = Main.panel.statusArea.quickSettings;
    const grid = quickSettings.menu._grid;
    if (!grid || grid.get_n_children() === 0)
        return false;

    const networkItems = quickSettings._network?.quickSettingsItems;
    if (networkItems?.length > 0) {
        grid.set_child_above_sibling(toggle, networkItems[networkItems.length - 1]);
        return true;
    }

    const bluetoothItems = quickSettings._bluetooth?.quickSettingsItems;
    if (bluetoothItems?.length > 0) {
        grid.set_child_below_sibling(toggle, bluetoothItems[0]);
        return true;
    }

    return false;
}
