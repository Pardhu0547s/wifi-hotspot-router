#!/bin/bash
# Wi-Fi Hotspot Router - Automated Deployment & Setup
# Installs system dependencies, engine scripts, systemd units, polkit rules, and GNOME extension files.

set -e

UUID="wifi-hotspot-router@pardhu0547s.github.com"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "$SUDO_USER" ]; then
    USER_NAME="$SUDO_USER"
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
elif [ -n "$PKEXEC_UID" ]; then
    USER_NAME=$(getent passwd "$PKEXEC_UID" | cut -d: -f1)
    REAL_HOME=$(getent passwd "$PKEXEC_UID" | cut -d: -f6)
else
    USER_NAME=$(whoami)
    REAL_HOME="$HOME"
fi
TARGET_DIR="$REAL_HOME/.local/share/gnome-shell/extensions/$UUID"

echo "=== Phase 1: Package Manager Dependencies ==="

if command -v apt-get >/dev/null 2>&1; then
    PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
elif command -v pacman >/dev/null 2>&1; then
    PKG_MGR="pacman"
elif command -v zypper >/dev/null 2>&1; then
    PKG_MGR="zypper"
else
    PKG_MGR="unknown"
fi

MISSING_TOOLS=()
for tool in hostapd dnsmasq iw iptables ip qrencode glib-compile-schemas python3 pkexec; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        MISSING_TOOLS+=("$tool")
    fi
done

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
    echo "Installing required packages via $PKG_MGR (${MISSING_TOOLS[*]})..."
    case "$PKG_MGR" in
        apt)
            sudo apt-get update -y || true
            sudo apt-get install -y hostapd dnsmasq iw iptables iproute2 qrencode python3 libglib2.0-bin procps pkexec polkitd
            ;;
        dnf)
            sudo dnf install -y hostapd dnsmasq iw iptables iproute qrencode python3 glib2-devel procps-ng polkit
            ;;
        pacman)
            sudo pacman -Sy --noconfirm hostapd dnsmasq iw iptables iproute2 qrencode python glib2 procps-ng polkit
            ;;
        zypper)
            sudo zypper install -y hostapd dnsmasq iw iptables iproute2 qrencode python3 glib2-devel procps polkit
            ;;
        *)
            echo "Warning: Unknown package manager. Ensure the following tools are installed: ${MISSING_TOOLS[*]}"
            ;;
    esac
else
    echo "All core system dependencies are satisfied."
fi

# Locate or download create_ap
CREATE_AP_PATH=$(command -v create_ap || true)
if [ -z "$CREATE_AP_PATH" ]; then
    if [ -x "/usr/local/bin/create_ap" ]; then
        CREATE_AP_PATH="/usr/local/bin/create_ap"
    elif [ -x "/usr/bin/create_ap" ]; then
        CREATE_AP_PATH="/usr/bin/create_ap"
    else
        echo "Fetching create_ap from upstream repository into /usr/local/bin/create_ap..."
        if command -v curl >/dev/null 2>&1; then
            sudo curl -sSL https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap -o /usr/local/bin/create_ap
            sudo chmod +x /usr/local/bin/create_ap
            CREATE_AP_PATH="/usr/local/bin/create_ap"
        elif command -v wget >/dev/null 2>&1; then
            sudo wget -qO /usr/local/bin/create_ap https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap
            sudo chmod +x /usr/local/bin/create_ap
            CREATE_AP_PATH="/usr/local/bin/create_ap"
        else
            echo "Error: create_ap is not installed and neither curl nor wget was found." >&2
            exit 1
        fi
    fi
fi
echo "Using create_ap at $CREATE_AP_PATH"

echo "=== Phase 2: Schema Compilation ==="
if [ -d "$SOURCE_DIR/schemas" ]; then
    glib-compile-schemas "$SOURCE_DIR/schemas"
    echo "Schemas compiled successfully."
fi

echo "=== Phase 3: Patching create_ap ==="
if [ -f "${CREATE_AP_PATH}.bak" ]; then
    sudo cp "${CREATE_AP_PATH}.bak" "$CREATE_AP_PATH"
else
    sudo cp "$CREATE_AP_PATH" "${CREATE_AP_PATH}.bak"
fi
sudo python3 "$SOURCE_DIR/scripts/patch_create_ap.py" "$CREATE_AP_PATH"

echo "=== Phase 4: Installing Backend Binaries ==="
sudo install -d -m 755 /usr/local/bin
sudo install -m 755 "$SOURCE_DIR/bin/start_hotspot" /usr/local/bin/start_hotspot
sudo install -m 755 "$SOURCE_DIR/bin/start_hotspot_post" /usr/local/bin/start_hotspot_post
sudo install -m 755 "$SOURCE_DIR/bin/stop_hotspot" /usr/local/bin/stop_hotspot
sudo install -m 755 "$SOURCE_DIR/bin/manage_hotspot_clients" /usr/local/bin/manage_hotspot_clients

echo "=== Phase 5: Installing systemd Service ==="
sudo install -d -m 755 /etc/systemd/system
sudo install -m 644 "$SOURCE_DIR/systemd/wifi-hotspot@.service" /etc/systemd/system/wifi-hotspot@.service
sudo systemctl daemon-reload

echo "=== Phase 6: Installing Polkit Authorization ==="
if [ -d "/etc/polkit-1/rules.d" ]; then
    sudo install -m 644 "$SOURCE_DIR/polkit/99-wifi-hotspot.rules" /etc/polkit-1/rules.d/99-wifi-hotspot.rules
fi
sudo install -d -m 755 /usr/share/polkit-1/actions
sudo install -m 644 "$SOURCE_DIR/polkit/org.gnome.shell.extensions.wifi-hotspot.policy" /usr/share/polkit-1/actions/org.gnome.shell.extensions.wifi-hotspot.policy

echo "=== Phase 7: Configuring NetworkManager ==="
sudo install -d -m 755 /etc/NetworkManager/conf.d
sudo tee /etc/NetworkManager/conf.d/99-wifi-hotspot-unmanage.conf > /dev/null <<\EOF_NM
[keyfile]
unmanaged-devices=interface-name:*_ap;interface-name:ap0;interface-name:ap1;interface-name:vmnet*
EOF_NM
sudo rm -f /etc/udev/rules.d/99-wifi-hotspot-cleanup.rules 2>/dev/null || true
sudo systemctl reload NetworkManager 2>/dev/null || sudo systemctl restart NetworkManager 2>/dev/null || true

echo "=== Phase 8: Deploying GNOME Extension ==="
mkdir -p "$REAL_HOME/.local/share/gnome-shell/extensions"
rm -rf "$TARGET_DIR"

if [ "$1" = "--link" ] || [ "$1" = "--dev" ]; then
    ln -s "$SOURCE_DIR" "$TARGET_DIR"
    [ -n "$SUDO_USER" ] && chown -h "$USER_NAME:$USER_NAME" "$TARGET_DIR" 2>/dev/null || true
    echo "Extension symlinked to $TARGET_DIR (development mode)."
else
    mkdir -p "$TARGET_DIR"
    cp "$SOURCE_DIR/metadata.json" "$TARGET_DIR/"
    cp "$SOURCE_DIR/extension.js" "$TARGET_DIR/"
    cp "$SOURCE_DIR/prefs.js" "$TARGET_DIR/"
    cp "$SOURCE_DIR/stylesheet.css" "$TARGET_DIR/"
    cp -r "$SOURCE_DIR/schemas" "$TARGET_DIR/"
    cp -r "$SOURCE_DIR/lib" "$TARGET_DIR/"
    cp -r "$SOURCE_DIR/shell" "$TARGET_DIR/"
    [ -n "$SUDO_USER" ] && chown -R "$USER_NAME:$USER_NAME" "$TARGET_DIR" 2>/dev/null || true
    echo "Extension installed to $TARGET_DIR."
fi

echo "=== Phase 9: Default Configuration ==="
CONFIG_DEST="$REAL_HOME/.config/wifi-hotspot.conf"
if [ ! -f "$CONFIG_DEST" ]; then
    mkdir -p "$REAL_HOME/.config"
    cat <<\EOF_CONF > "$CONFIG_DEST"
SSID="hotspot"
PASSWORD="hotspotpassword"
BAND="bg"
EOF_CONF
    chmod 600 "$CONFIG_DEST"
    [ -n "$SUDO_USER" ] && chown "$USER_NAME:$USER_NAME" "$CONFIG_DEST" 2>/dev/null || true
fi

echo "Installation complete."
echo "Enable extension with:"
echo "    gnome-extensions enable $UUID"
