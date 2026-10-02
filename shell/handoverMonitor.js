import GLib from 'gi://GLib';
import NM from 'gi://NM';

import {isCancelled, removeSource} from '../lib/utils.js';

const WATCHDOG_SECONDS = 20;
const RESUME_DELAY_MS = 800;
const RECOVER_DELAY_MS = 1500;

export class WifiHandoverMonitor {
    constructor(service, runner, {canHandover, onStatus, onFinished}) {
        this._service = service;
        this._runner = runner;
        this._canHandover = canHandover;
        this._onStatus = onStatus;
        this._onFinished = onFinished;

        this._inProgress = false;
        this._watchdogId = 0;
        this._restartId = 0;
        this._client = null;
        this._clientSignalIds = [];
        this._deviceSignals = [];

        NM.Client.new_async(this._runner.cancellable, (_source, result) => this._onClientReady(result));
    }

    abort() {
        this._inProgress = false;
        this._watchdogId = removeSource(this._watchdogId);
        this._restartId = removeSource(this._restartId);
    }

    destroy() {
        this.abort();
        this._unwatchDevices();
        for (const id of this._clientSignalIds)
            this._client.disconnect(id);
        this._clientSignalIds = [];
        this._client = null;
    }

    _onClientReady(result) {
        try {
            this._client = NM.Client.new_finish(result);
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`NetworkManager is not available: ${e.message}`);
            return;
        }

        this._clientSignalIds.push(
            this._client.connect('device-added', () => this._watchDevices()),
            this._client.connect('device-removed', () => this._watchDevices()));
        this._watchDevices();
    }

    _watchDevices() {
        this._unwatchDevices();

        for (const device of this._client.get_devices()) {
            if (device.get_device_type() !== NM.DeviceType.WIFI)
                continue;

            const iface = device.get_iface();
            if (iface && (iface === 'ap0' || iface === 'ap1' || iface.endsWith('_ap')))
                continue;

            const id = device.connect('state-changed', (_device, newState, oldState) =>
                this._onDeviceStateChanged(newState, oldState));
            this._deviceSignals.push({device, id});
        }
    }

    _unwatchDevices() {
        for (const {device, id} of this._deviceSignals)
            device.disconnect(id);
        this._deviceSignals = [];
    }

    _onDeviceStateChanged(newState, oldState) {
        const {PREPARE, CONFIG, NEED_AUTH, ACTIVATED, FAILED, DISCONNECTED} = NM.DeviceState;

        if (newState === PREPARE || newState === CONFIG || newState === NEED_AUTH) {
            this._begin();
        } else if (newState === ACTIVATED) {
            if (this._inProgress)
                this._scheduleRestart('Resuming hotspot...', RESUME_DELAY_MS);
        } else if (newState === FAILED || (newState === DISCONNECTED && oldState === CONFIG)) {
            if (this._inProgress)
                this._scheduleRestart('Recovering hotspot...', RECOVER_DELAY_MS);
        }
    }

    _begin() {
        if (this._inProgress || !this._canHandover())
            return;

        this._inProgress = true;

        this._watchdogId = removeSource(this._watchdogId);
        this._watchdogId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WATCHDOG_SECONDS, () => {
            this._watchdogId = 0;
            if (this._inProgress) {
                this._inProgress = false;
                this._onFinished();
            }
            return GLib.SOURCE_REMOVE;
        });

        this._onStatus('Switching Wi-Fi...', 'Switching Wi-Fi network...');
        this._stopService();
    }

    _scheduleRestart(statusText, delayMs) {
        this._watchdogId = removeSource(this._watchdogId);
        this._onStatus(statusText);

        this._restartId = removeSource(this._restartId);
        this._restartId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._restartId = 0;
            this._restartService();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _stopService() {
        try {
            await this._service.stop();
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`Could not stop the hotspot service: ${e.message}`);
        }
    }

    async _restartService() {
        if (!this._inProgress)
            return;

        try {
            await this._service.start();
        } catch (e) {
            if (isCancelled(e))
                return;
            console.warn(`Could not restart the hotspot service: ${e.message}`);
        }

        this._inProgress = false;
        this._onFinished();
    }
}
