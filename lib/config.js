import GLib from 'gi://GLib';

import {readTextFileSync} from './utils.js';

const CONFIG_FILE_NAME = 'wifi-hotspot.conf';
const LINE_PATTERN = /^(\w+)\s*=\s*"(.*)"$/;
const PASSPHRASE_PATTERN = /^[\x20-\x7E]{8,63}$/;

const UNSAFE_CHARS = /[\\"$`\r\n]/;

function configPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), CONFIG_FILE_NAME]);
}

export function isValidSsid(ssid) {
    const byteLength = new TextEncoder().encode(ssid).length;
    return byteLength >= 1 && byteLength <= 32 && !UNSAFE_CHARS.test(ssid);
}

export function isValidPassphrase(passphrase) {
    return PASSPHRASE_PATTERN.test(passphrase) && !UNSAFE_CHARS.test(passphrase);
}

export function readConfig() {
    const config = {ssid: 'hotspot', password: '', band: 'bg'};
    const text = readTextFileSync(configPath());
    if (text === null)
        return config;

    for (const line of text.split('\n')) {
        const match = line.trim().match(LINE_PATTERN);
        if (!match)
            continue;

        const [, key, value] = match;
        if (key === 'SSID')
            config.ssid = value;
        else if (key === 'PASSWORD')
            config.password = value;
        else if (key === 'BAND')
            config.band = value;
    }
    return config;
}

export function saveConfig({ssid, password, band}) {
    GLib.mkdir_with_parents(GLib.get_user_config_dir(), 0o700);
    const path = configPath();
    GLib.file_set_contents(path, `SSID="${ssid}"\nPASSWORD="${password}"\nBAND="${band}"\n`);
    GLib.chmod(path, 0o600);
}

export function loadOrCreateConfig() {
    const config = readConfig();
    if (config.password)
        return config;

    config.password = GLib.uuid_string_random().replace(/-/g, '').substring(0, 12);
    try {
        saveConfig(config);
    } catch (e) {
        console.warn(`Could not store the generated hotspot passphrase: ${e.message}`);
    }
    return config;
}

