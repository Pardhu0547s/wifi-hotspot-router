#!/bin/bash

# Exit on error
set -e

# Configuration constraints
UUID="wifi-hotspot-router@pardhu0547s.github.com"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SOURCE_DIR="/home/pavan/WorkSpace/WIFI-HOTSPOT"

echo "=== Phase 1: Compiling GSettings Schemas ==="
if [ -d "$SOURCE_DIR/schemas" ]; then
    glib-compile-schemas "$SOURCE_DIR/schemas"
    echo "[+] GSettings schemas compiled successfully."
else
    echo "[-] Error: schemas directory not found."
    exit 1
fi

echo -e "\n=== Phase 2: Patching /usr/bin/create_ap for Client Limits ==="
# Restore from backup first if it exists to ensure a clean state
if [ -f "/usr/bin/create_ap.bak" ]; then
    echo "[+] Restoring /usr/bin/create_ap from backup first..."
    sudo cp /usr/bin/create_ap.bak /usr/bin/create_ap
fi

# Create backup if not present
if [ ! -f "/usr/bin/create_ap.bak" ]; then
    sudo cp /usr/bin/create_ap /usr/bin/create_ap.bak
fi

echo "[+] Patching /usr/bin/create_ap..."
sudo sed -i '/ap_isolate=\$ISOLATE_CLIENTS/{n;s/EOF/EOF\n\[\[ -n "\$MAX_NUM_STA" \]\] \&\& echo "max_num_sta=\$MAX_NUM_STA" >> \$CONFDIR\/hostapd.conf/}' /usr/bin/create_ap
echo "[+] /usr/bin/create_ap successfully patched."

echo -e "\n=== Phase 3: Creating/Updating start_hotspot ==="
echo "[+] Creating /usr/local/bin/start_hotspot..."
sudo tee /usr/local/bin/start_hotspot > /dev/null <<'EOF'
#!/bin/bash
# Arguments:
# $1: SSID (default: Fedora)
# $2: Password (default: 12345678, or "NONE" for no password)
# $3: Max Clients (default: 8, or "0" for unlimited)

SSID="${1:-Fedora}"
PASSWORD="${2:-12345678}"
MAX_CLIENTS="${3:-8}"

echo "Starting Hotspot with SSID='$SSID', Password='[HIDDEN]', Max Clients='$MAX_CLIENTS'..."

# Step 1: Clear out local DNS system conflicts completely
sudo systemctl stop dnsmasq 2>/dev/null || true
sudo systemctl stop systemd-resolved 2>/dev/null || true
sudo fuser -k 53/udp 53/tcp 67/udp 2>/dev/null || true

# Step 2: Stop Fedora's firewall from blocking DHCP/DNS traffic
sudo systemctl stop firewalld 2>/dev/null || true

# Step 3: Setup Max Clients in environment if not zero/unlimited
if [ "$MAX_CLIENTS" -ne "0" ] 2>/dev/null; then
    export MAX_NUM_STA="$MAX_CLIENTS"
else
    unset MAX_NUM_STA
fi

# Step 4: Launch Hotspot with native NAT and auto-DHCP
# Matches Channel 2 dynamically to prevent driver modes crashing
if [ "$PASSWORD" = "NONE" ]; then
    sudo create_ap -c 2 --dhcp-dns 8.8.8.8 wlo1 wlo1 "$SSID"
else
    sudo create_ap -c 2 --dhcp-dns 8.8.8.8 wlo1 wlo1 "$SSID" "$PASSWORD"
fi
EOF
sudo chmod +x /usr/local/bin/start_hotspot
echo "[+] /usr/local/bin/start_hotspot updated."

echo -e "\n=== Phase 4: Creating/Updating stop_hotspot ==="
echo "[+] Creating /usr/local/bin/stop_hotspot..."
sudo tee /usr/local/bin/stop_hotspot > /dev/null <<'EOF'
#!/bin/bash
# Step 1: Stop create_ap hotspot
sudo create_ap --stop wlo1 || true

# Step 2: Re-enable management of wlo1 under NetworkManager
sudo nmcli dev set wlo1 managed yes || true

# Step 3: Restore system network and firewall states
sudo systemctl start systemd-resolved 2>/dev/null || true
sudo systemctl start firewalld 2>/dev/null || true
sudo systemctl restart NetworkManager || true
EOF
sudo chmod +x /usr/local/bin/stop_hotspot
echo "[+] /usr/local/bin/stop_hotspot updated."

echo -e "\n=== Phase 5: Setting Up Sudoers Passwordless Access ==="
USER_NAME=$(whoami)
echo "[+] Granting passwordless sudo access for hotspot scripts to user '$USER_NAME'..."
sudo tee /etc/sudoers.d/hotspot > /dev/null <<EOF
$USER_NAME ALL=(ALL) NOPASSWD: /usr/local/bin/start_hotspot, /usr/local/bin/stop_hotspot
EOF
sudo chmod 0440 /etc/sudoers.d/hotspot
echo "[+] /etc/sudoers.d/hotspot rules applied."

echo -e "\n=== Phase 6: Deploying GNOME Extension ==="
mkdir -p "$HOME/.local/share/gnome-shell/extensions"

# Handle existing deployments/symlinks cleanly
if [ -L "$TARGET_DIR" ] || [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
fi

ln -s "$SOURCE_DIR" "$TARGET_DIR"
echo "[+] Symlink successfully pointing to development workspace directory."

echo -e "\n=== Phase 7: Activation Guidelines ==="
echo "If you have already restarted GNOME Shell, you can enable the extension by running:"
echo "    gnome-extensions enable $UUID"
echo "Otherwise, restart GNOME Shell (log out and back in) and then run the command."
echo "=========================================================="
