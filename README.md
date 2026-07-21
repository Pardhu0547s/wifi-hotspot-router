# Wi-Fi Hotspot Router (GNOME Shell Extension)

A GNOME Shell Quick Settings toggle to run a simultaneous Wi-Fi hotspot in Linux without losing your active internet/Wi-Fi connection.

![GNOME Quick Settings Toggle](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot.png)
![GNOME Quick Settings Menu](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot-menu.png)

## 📡 The Problem & Solution
Standard NetworkManager configurations typically treat your wireless interface as either a client (connecting to the internet) or an Access Point (broadcasting a hotspot). Toggling one disables the other.

This extension resolves this by executing `create_ap` (which creates a virtual interface `ap0` under the hood) on the exact same frequency channel as your primary internet interface.

To bypass password prompts and maintain review-compliancy guidelines for the GNOME Extensions store, a passwordless systemd service template and custom Polkit rules are deployed. This gives you a smooth, zero-friction toggle switch directly in your panel without requiring any `sudo` inside the Javascript extension layer.

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

![Hotspot Settings Panel](https://github.com/Pardhu0547s/wifi-hotspot-router/raw/main/screenshot-settings.png)

---

## 👥 Authors & Contribution
- Created by [Pardhu0547s](https://github.com/Pardhu0547s)
- Feel free to open issues or submit pull requests!
