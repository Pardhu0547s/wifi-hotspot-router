# Advanced Wi-Fi Hotspot Router (GNOME Shell Extension)

A premium GNOME Shell Quick Settings toggle to run a simultaneous Wi-Fi hotspot in Linux without losing your active internet/Wi-Fi connection.

![GNOME Quick Settings Toggle](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot.png) *(Placeholder URL for screenshot)*

## 📡 The Problem & Solution
Standard NetworkManager configurations typically treat your wireless interface as either a client (connecting to the internet) or an Access Point (broadcasting a hotspot). Toggling one disables the other.

This extension resolves this by executing `create_ap` (which creates a virtual interface `ap0` under the hood) on the exact same frequency channel as your primary internet interface.

To bypass password prompts on every toggle, a minor passwordless sudoers rule is created for two specific starting and stopping wrappers, giving you a smooth, zero-friction toggle switch in your panel.

---

## 🛠️ Installation

### 1. Prerequisites
The extension relies on `linux-wifi-hotspot` (`create_ap`). Install it along with necessary system dependencies:

```bash
# Fedora
sudo dnf install -y glib2-devel gtk3-devel pkgconf-pkg-config qrencode-devel
# Then install/build linux-wifi-hotspot from: https://github.com/lakinduakash/linux-wifi-hotspot
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
- Securely patch `/usr/bin/create_ap` to support connected client limits.
- Install `/usr/local/bin/start_hotspot` and `/usr/local/bin/stop_hotspot`.
- Install passwordless sudo rules inside `/etc/sudoers.d/hotspot` for these two scripts.
- Deploy the extension symlink to your GNOME Shell extensions directory.

### 3. Activating
1. **Restart GNOME Shell**: Since Fedora uses Wayland by default, log out of your session and log back in.
2. **Enable the Extension**:
   ```bash
   gnome-extensions enable wifi-hotspot-router@pavan.github.com
   ```
3. Open GNOME **Extension Manager**, click the gear icon (⚙️) next to the extension, and configure your settings!

---

## ⚙️ Configuration Options
You can open the settings panel directly from Extension Manager to configure:
- **SSID (Hotspot Name)**: Network name (defaults to `Fedora`).
- **Security Mode**: Enable or disable WPA2 password protection.
- **Passphrase**: Set a WPA2 password.
- **Max Connected Devices**: Limit the number of clients that can connect (set to 0 for unlimited).

---

## 👥 Authors & Contribution
- Created by [Pardhu0547s](https://github.com/Pardhu0547s)
- Feel free to open issues or submit pull requests!
