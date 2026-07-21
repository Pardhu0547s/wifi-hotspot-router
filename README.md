# Wi-Fi Hotspot Router (GNOME Shell Extension)

A GNOME Shell Quick Settings toggle to run a simultaneous Wi-Fi hotspot in Linux without losing your active internet/Wi-Fi connection.

![GNOME Quick Settings Toggle](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot.png)
![GNOME Quick Settings Menu](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot-menu.png)

## 📡 The Problem & Solution
Standard NetworkManager configurations typically treat your wireless interface as either a client (connecting to the internet) or an Access Point (broadcasting a hotspot). Toggling one disables the other.

This extension resolves this by executing `create_ap` (which creates a virtual interface `ap0` under the hood) on the exact same frequency channel as your primary internet interface.

To avoid interactive password prompts, `setup.sh` deploys a passwordless systemd service template with Polkit authorization for hotspot start/stop, and a narrowly scoped sudoers rule for client management. This gives you a smooth, zero-friction toggle switch directly in your panel. See the [Security Architecture](#-security-architecture) section below for full details.

---

## 🛠️ Installation

### 1. Prerequisites
The extension relies on `linux-wifi-hotspot` (`create_ap`). Install it along with necessary system dependencies:

```bash
# Fedora
sudo dnf install -y glib2-devel gtk3-devel pkgconf-pkg-config qrencode-devel

# Ubuntu / Debian (Method 1: Streamlined via curl)
sudo apt update
sudo apt install -y hostapd dnsmasq iw haveged iptables procps iproute2
sudo curl -L https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap -o /usr/bin/create_ap
sudo chmod +x /usr/bin/create_ap

# Ubuntu / Debian (Method 2: Manual Build)
sudo apt install -y libgtk-3-dev build-essential gcc g++ pkg-config make hostapd libqrencode-dev libpng-dev
git clone https://github.com/lakinduakash/linux-wifi-hotspot
cd linux-wifi-hotspot
make
sudo make install
cd ..

# Arch Linux
sudo pacman -S gtk3 pkgconf qrencode linux-wifi-hotspot
```

### 2. Running Setup
Clone the repository and run the setup script:

```bash
cd wifi-hotspot-router
chmod +x setup.sh
./setup.sh
```

The script will:
- Compile GSettings schemas locally.
- Restore and securely patch `/usr/bin/create_ap` to support connected client limits.
- Install `/usr/local/bin/start_hotspot` and `/usr/local/bin/stop_hotspot`.
- Deploy the systemd service template `/etc/systemd/system/wifi-hotspot@.service`.
- Install custom Polkit rules `/etc/polkit-1/rules.d/99-wifi-hotspot.rules` to authorize starts and stops without password prompts.
- Deploy the extension symlink to your GNOME Shell extensions directory.

### 3. Activating
1. **Restart GNOME Shell**: Since Fedora uses Wayland by default, log out of your session and log back in.
2. **Enable the Extension**:
   ```bash
   gnome-extensions enable wifi-hotspot-router@pardhu0547s.github.com
   ```
3. Open GNOME **Extensions** or GNOME **Extension Manager**, click the gear icon (⚙️) next to the extension, and configure your settings!

---

## ⚙️ Configuration Options
You can open the settings panel to configure:
- **SSID (Hotspot Name)**: Network name (defaults to `hotspot`).
- **Security Mode**: Enable or disable WPA2 password protection.
- **Passphrase**: Set a WPA2 password (stored securely in `~/.config/wifi-hotspot.conf` with `600` permissions).
- **Max Connected Devices**: Limit the number of clients that can connect.

---

## 🔒 Security Architecture

GNOME Extensions run inside the GNOME Shell process, which operates as an unprivileged user. However, managing a Wi-Fi hotspot requires root-level access to networking subsystems. This extension solves the privilege gap using **three independent, narrowly scoped mechanisms** — none of which require embedding `sudo` inside the JavaScript extension layer.

### Why Root Access Is Needed

| Operation | Underlying Tool | Why Root Is Required |
|---|---|---|
| Starting/stopping the hotspot | `create_ap`, `hostapd`, `dnsmasq` | Creating virtual wireless interfaces (`ap0`), configuring `hostapd` for AP mode, and running a DHCP server all require `CAP_NET_ADMIN` privileges |
| Blocking/unblocking clients | `iptables`, `hostapd_cli`, `iw` | Inserting firewall rules (`iptables -I FORWARD -m mac --mac-source ... -j DROP`) and issuing `hostapd_cli disassociate` commands require root |
| Listing connected devices | `iw dev <iface> station dump` | Querying the kernel's wireless station table requires `CAP_NET_ADMIN` |

### How Privilege Escalation Works

The extension **never** runs arbitrary commands as root. Instead, `setup.sh` installs three tightly controlled privilege pathways:

#### 1. Systemd Service Template (Start/Stop Hotspot)
A parameterized systemd unit (`wifi-hotspot@.service`) is installed at `/etc/systemd/system/`. The extension calls `systemctl start wifi-hotspot@<username>.service` to toggle the hotspot. The service unit executes only the pre-installed `/usr/local/bin/start_hotspot` script — nothing else.

```
extension.js → systemctl start/stop → systemd → /usr/local/bin/start_hotspot
```

#### 2. Polkit Rules (Passwordless systemctl)
A custom Polkit rule is installed at `/etc/polkit-1/rules.d/99-wifi-hotspot.rules`. This rule authorizes **only** the `wifi-hotspot@.service` unit to be started and stopped by active local users without a password prompt. It does not grant blanket `systemctl` access.

```javascript
// Polkit rule (installed by setup.sh)
polkit.addRule(function(action, subject) {
    if (action.id === "org.freedesktop.systemd1.manage-units" &&
        action.lookup("unit").indexOf("wifi-hotspot@") === 0 &&
        subject.isInGroup("users") && subject.local && subject.active) {
        return polkit.Result.YES;
    }
});
```

#### 3. Sudoers Rule (Client Management)
A narrowly scoped sudoers rule is installed at `/etc/sudoers.d/wifi-hotspot`. It grants **passwordless execution of exactly one script** — `/usr/local/bin/manage_hotspot_clients` — and nothing else. This script is a fixed, pre-installed shell script (not user-modifiable at runtime) that handles listing connected devices, blocking MACs, and unblocking MACs.

```
# Sudoers rule (installed by setup.sh)
ALL ALL=(ALL) NOPASSWD: /usr/local/bin/manage_hotspot_clients
```

The extension invokes it as:
```
extension.js → sudo /usr/local/bin/manage_hotspot_clients <action> <mac> <username>
```

### What the Extension JavaScript Actually Executes

| Action | Command | Privilege Source |
|---|---|---|
| Toggle hotspot ON | `systemctl start wifi-hotspot@<user>.service` | Polkit rule |
| Toggle hotspot OFF | `systemctl stop wifi-hotspot@<user>.service` | Polkit rule |
| List connected devices | `sudo /usr/local/bin/manage_hotspot_clients list "" <user>` | Sudoers rule |
| Block a device | `sudo /usr/local/bin/manage_hotspot_clients block <mac> <user>` | Sudoers rule |
| Unblock a device | `sudo /usr/local/bin/manage_hotspot_clients unblock <mac> <user>` | Sudoers rule |
| Check hotspot status | `systemctl is-active wifi-hotspot@<user>.service` | No privilege needed |

### Security Guarantees

- **No arbitrary command execution**: The extension can only call `systemctl` (gated by Polkit) and one fixed script (gated by sudoers).
- **No secrets in GSettings**: The WPA2 password is stored in `~/.config/wifi-hotspot.conf` with `chmod 600` (owner-only read/write), never in the dconf database.
- **No network downloads**: The extension does not fetch any external resources at runtime.
- **Full cleanup on disable**: The `disable()` method destroys all UI elements and removes all GLib timeout sources, leaving the shell in its original state.

---

## 👥 Authors & Contribution
- Created by [Pardhu0547s](https://github.com/Pardhu0547s)
- Feel free to open issues or submit pull requests!
