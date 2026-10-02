import GLib from 'gi://GLib';

import {readTextFile} from './utils.js';

const CONFIG_FILE_NAME = 'wifi-hotspot.conf';
const LINE_PATTERN = /^(\w+)\s*=\s*"(.*)"$/;
const PASSPHRASE_PATTERN = /^[\x20-\x7E]{8,63}$/;

// The file is written as KEY="value" and also read by the service script,
// so characters that could break that format are rejected.
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

/**
 * @returns {{ssid: string, password: string, band: string}} stored settings;
 *   password is empty if none has been stored yet
 */
export function readConfig() {
    const config = {ssid: 'hotspot', password: '', band: 'bg'};
    const text = readTextFile(configPath());
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

/**
 * @param {{ssid: string, password: string, band: string}} config - settings to store
 * @throws {GLib.Error} if the file cannot be written
 */
export function saveConfig({ssid, password, band}) {
    GLib.mkdir_with_parents(GLib.get_user_config_dir(), 0o700);
    const path = configPath();
    GLib.file_set_contents(path, `SSID="${ssid}"\nPASSWORD="${password}"\nBAND="${band}"\n`);
    GLib.chmod(path, 0o600);
}

/**
 * Read the stored settings, generating and storing a random passphrase on the
 * first run.
 *
 * @returns {{ssid: string, password: string, band: string}}
 */
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
