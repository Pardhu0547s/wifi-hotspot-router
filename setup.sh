#!/bin/bash

# Exit on error
set -e

# Configuration constraints
UUID="wifi-hotspot-router@pardhu0547s.github.com"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SOURCE_DIR="/home/pavan/WorkSpace/WIFI-HOTSPOT"
USER_NAME=$(whoami)

echo "=== Phase 1: Compiling GSettings Schemas ==="
if [ -d "$SOURCE_DIR/schemas" ]; then
    glib-compile-schemas "$SOURCE_DIR/schemas"
    echo "[+] GSettings schemas compiled successfully."
else
    echo "[-] Error: schemas directory not found."
    exit 1
fi

echo -e "\n=== Phase 2: Restoring and Patching /usr/bin/create_ap ==="
if [ -f "/usr/bin/create_ap.bak" ]; then
    echo "[+] Restoring /usr/bin/create_ap from backup..."
    sudo cp /usr/bin/create_ap.bak /usr/bin/create_ap
else
    if [ -f "/usr/bin/create_ap" ]; then
        echo "[+] Backing up original /usr/bin/create_ap..."
        sudo cp /usr/bin/create_ap /usr/bin/create_ap.bak
    else
        echo "[-] Error: Neither /usr/bin/create_ap nor /usr/bin/create_ap.bak was found."
        echo "Please ensure linux-wifi-hotspot is installed."
        exit 1
    fi
fi

echo "[+] Patching /usr/bin/create_ap for Client Limits..."
sudo sed -i '/ap_isolate=\$ISOLATE_CLIENTS/{n;s/EOF/EOF\n\[\[ -n "\$MAX_NUM_STA" \]\] \&\& echo "max_num_sta=\$MAX_NUM_STA" >> \$CONFDIR\/hostapd.conf/}' /usr/bin/create_ap
echo "[+] /usr/bin/create_ap successfully patched."

echo -e "\n=== Phase 3: Installing start_hotspot and stop_hotspot ==="
# start_hotspot
sudo tee /usr/local/bin/start_hotspot > /dev/null <<'EOF'
#!/bin/bash
USER_NAME="$1"
if [ -z "$USER_NAME" ]; then
    echo "Error: Username parameter is required."
    exit 1
fi

CONFIG_FILE="/home/$USER_NAME/.config/wifi-hotspot.conf"

# Default fallback values
SSID="hotspot"
USE_PASSWORD="true"
PASSWORD="none"
MAX_CLIENTS="10"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

# Clean up any leftover virtual interfaces from previous runs
/usr/bin/create_ap --stop wlo1 2>/dev/null || true
/usr/sbin/iw dev ap0 del 2>/dev/null || true
/usr/sbin/iw dev ap1 del 2>/dev/null || true

# Step 1: Clear out local DNS system conflicts completely
/usr/bin/systemctl stop dnsmasq 2>/dev/null || true
/usr/bin/systemctl stop systemd-resolved 2>/dev/null || true
/usr/bin/fuser -k 53/udp 53/tcp 67/udp 2>/dev/null || true

# Step 2: Stop Fedora's firewall from blocking DHCP/DNS traffic
/usr/bin/systemctl stop firewalld 2>/dev/null || true

# Step 3: Setup Max Clients in environment if not zero/unlimited
if [ "$MAX_CLIENTS" -ne "0" ] 2>/dev/null; then
    export MAX_NUM_STA="$MAX_CLIENTS"
else
    unset MAX_NUM_STA
fi

# Step 4: Launch Hotspot with native NAT and auto-DHCP
if [ "$USE_PASSWORD" = "false" ] || [ "$PASSWORD" = "none" ] || [ -z "$PASSWORD" ]; then
    /usr/bin/create_ap -c 2 --dhcp-dns 8.8.8.8 wlo1 wlo1 "$SSID"
else
    /usr/bin/create_ap -c 2 --dhcp-dns 8.8.8.8 wlo1 wlo1 "$SSID" "$PASSWORD"
fi
EOF
sudo chmod +x /usr/local/bin/start_hotspot

# stop_hotspot
sudo tee /usr/local/bin/stop_hotspot > /dev/null <<'EOF'
#!/bin/bash
/usr/bin/create_ap --stop wlo1 || true
/usr/sbin/iw dev ap0 del 2>/dev/null || true
/usr/sbin/iw dev ap1 del 2>/dev/null || true
/usr/bin/nmcli dev set wlo1 managed yes || true
/usr/bin/systemctl start systemd-resolved 2>/dev/null || true
/usr/bin/systemctl start firewalld 2>/dev/null || true
EOF
sudo chmod +x /usr/local/bin/stop_hotspot
echo "[+] Helper scripts installed."

echo -e "\n=== Phase 4: Installing systemd Service Template ==="
sudo tee /etc/systemd/system/wifi-hotspot@.service > /dev/null <<'EOF'
[Unit]
Description=Wi-Fi Hotspot Service for %i
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/start_hotspot %i
ExecStop=/usr/local/bin/stop_hotspot %i
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
echo "[+] systemd service template installed."

echo -e "\n=== Phase 5: Installing Polkit Authorization Rules ==="
sudo tee /etc/polkit-1/rules.d/99-wifi-hotspot.rules > /dev/null <<EOF
polkit.addRule(function(action, subject, context) {
    if (action.id == "org.freedesktop.systemd1.manage-units" &&
        action.lookup("unit").match(/^wifi-hotspot@.*\.service$/)) {
        return polkit.Result.YES;
    }
});
EOF
echo "[+] Polkit rules installed."

echo -e "\n=== Phase 6: Deploying GNOME Extension ==="
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
if [ -L "$TARGET_DIR" ] || [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
fi
ln -s "$SOURCE_DIR" "$TARGET_DIR"
echo "[+] Symlink successfully pointing to development workspace directory."

echo -e "\n=== Phase 7: Initialization ==="
# Initialize a default configuration file if not exists
CONFIG_DEST="$HOME/.config/wifi-hotspot.conf"
if [ ! -f "$CONFIG_DEST" ]; then
    echo '[+] Creating default config at ~/.config/wifi-hotspot.conf...'
    cat <<EOF > "$CONFIG_DEST"
SSID="hotspot"
USE_PASSWORD="true"
PASSWORD="12345678"
MAX_CLIENTS="10"
EOF
    chmod 600 "$CONFIG_DEST"
fi

echo -e "\n=== Phase 8: Activation Guidelines ==="
echo "Please restart GNOME Shell (log out and back in) to apply the changes."
echo "Then enable the extension:"
echo "    gnome-extensions enable $UUID"
echo "=========================================================="
