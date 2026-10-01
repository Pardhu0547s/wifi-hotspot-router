# Wi-Fi Hotspot Router (GNOME Shell Extension)

A high-performance GNOME Shell Quick Settings extension that allows simultaneous Wi-Fi hotspot sharing (AP + STA repeater mode) in Linux without disconnecting from your active internet connection.

![GNOME Quick Settings Menu](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot.png)
![Hotspot Preferences Configuration](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot-menu.png)

## 📡 The Problem & Solution
Standard NetworkManager configurations typically treat a wireless interface as either a client (connecting to upstream internet) or an Access Point (broadcasting a hotspot). Toggling one disables the other.

This extension solves this by creating a dedicated virtual AP interface (`ap0`) with a locally administered MAC address on the exact same frequency channel as your primary Wi-Fi connection.

To avoid interactive password prompts while adhering to the principle of least privilege, `setup.sh` deploys a native systemd service template with scoped Polkit authorization rules for start/stop actions and a dedicated Polkit action policy for client management.

---

## 🚀 Key Features
- **Concurrent Wi-Fi Repeater Mode**: Share Wi-Fi while staying connected to Wi-Fi on a single physical adapter.
- **Dynamic Spectrum Management**: Automatically calculates optimal High-Throughput (HT40+ vs HT40-) and Very High-Throughput (VHT80) capabilities across 2.4GHz and 5GHz channels to prevent hostapd initialization failures and maximize wireless speeds.
- **Advanced Security & Filtering**: Standard WPA2-PSK encryption, network-wide AdGuard ad & tracker blocking, and system sleep inhibition.

---

## 🛠️ Installation

### 1. Prerequisites
Install `linux-wifi-hotspot` (`create_ap`) along with required dependencies:

**Fedora**
```bash
sudo dnf install -y glib2-devel qrencode hostapd dnsmasq iw iptables procps-ng iproute polkit
sudo curl -L https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap -o /usr/local/bin/create_ap
sudo chmod +x /usr/local/bin/create_ap
```

**Ubuntu / Debian**
```bash
sudo apt update
sudo apt install -y hostapd dnsmasq iw iptables procps iproute2 qrencode pkexec polkitd libglib2.0-bin
sudo curl -L https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap -o /usr/local/bin/create_ap
sudo chmod +x /usr/local/bin/create_ap
```

**Arch Linux**
```bash
sudo pacman -S qrencode hostapd dnsmasq iw iptables iproute2 polkit linux-wifi-hotspot
```

### 2. Running Setup
Clone the repository and run the setup script:

```bash
git clone https://github.com/Pardhu0547s/wifi-hotspot-router.git
cd wifi-hotspot-router
chmod +x setup.sh
./setup.sh
```

The script will:
1. Validate required tools across package managers.
2. Compile GSettings schemas.
3. Patch `create_ap` for client limits, 5GHz IR-concurrent AP, and WPA3 support.
4. Install engine binaries into `/usr/local/bin/` (`start_hotspot`, `start_hotspot_post`, `stop_hotspot`, `manage_hotspot_clients`).
5. Install the systemd service template `/etc/systemd/system/wifi-hotspot@.service`.
6. Install scoped Polkit authorization rules and action policies.
7. Configure NetworkManager to ignore virtual AP interfaces (`ap0`, `ap1`, `*_ap`).
8. Symlink the extension into `~/.local/share/gnome-shell/extensions/`.

Alternatively, use the Makefile:
```bash
make build
sudo make install-system
make install-user
```

### 3. Activating
1. **Log out and log back in** (or restart GNOME Shell) to load new extension schemas.
2. **Enable the Extension**:
   ```bash
   gnome-extensions enable wifi-hotspot-router@pardhu0547s.github.com
   ```
3. Open GNOME **Extension Manager** or **Extensions**, click the Settings icon next to **Wi-Fi Hotspot Router**, and configure your network credentials.

---

## ⚙️ Configuration Options
- **Hotspot Name (SSID)**: Network name (1-32 characters).
- **Passphrase**: Minimum 8 characters, secured with standard WPA2-PSK (`0600` owner-only permissions).
- **Wired / Ethernet Hotspot Band**: 2.4 GHz (Long Range) or 5 GHz (High Speed) when broadcasting from a wired connection or offline. (When repeating Wi-Fi, the band automatically mirrors your Wi-Fi channel).
- **Block Ads & Trackers**: Filter advertisements, trackers, and malicious domains on all connected devices via AdGuard DNS.
- **Prevent System Sleep**: Inhibit laptop suspend while devices are connected.

---

## 🔒 Security Architecture

| Operation | Mechanism | Security Guarantee |
|---|---|---|
| Hotspot Start/Stop | `systemctl` + Polkit rule (`99-wifi-hotspot.rules`) | Authorizes only active local users to manage their own `wifi-hotspot@<username>.service`. No root passwords or blanket permissions. |
| Status Querying | System D-Bus `ListUnitsByNames` | Non-blocking, atomic status verification without spawning subprocesses or generating journal errors. |
| Client Management | `pkexec` + Polkit policy (`org.gnome.shell.extensions.wifi-hotspot.policy`) | Authorizes execution of `/usr/local/bin/manage_hotspot_clients`. Verifies caller UID against target account to prevent user spoofing. |
| Configuration Storage | Declarative parser (`~/.config/wifi-hotspot.conf`) | Root engine never sources user files directly, preventing arbitrary code injection. File secured with mode `0600`. |
| Input Sanitization | Regular expressions | All MAC addresses validated against `^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$`. SSIDs and parameters sanitized before execution. |

---

## 👥 Authors & Contribution
- Created and maintained by [Pardhu0547s](https://github.com/Pardhu0547s)
- Issues and pull requests are welcome!
