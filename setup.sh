#!/bin/bash

# Exit on error
set -e

# Configuration constraints
UUID="wifi-hotspot-router@pardhu0547s.github.com"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

echo "[+] Patching /usr/bin/create_ap for Client Limits and MAC Filter..."
sudo sed -i '/ap_isolate=\$ISOLATE_CLIENTS/{n;s/EOF/EOF\n\[\[ -n "\$MAX_NUM_STA" \]\] \&\& echo "max_num_sta=\$MAX_NUM_STA" >> \$CONFDIR\/hostapd.conf\n\[\[ -n "\$DENY_MAC_FILE" \]\] \&\& echo "macaddr_acl=0" >> \$CONFDIR\/hostapd.conf\n\[\[ -n "\$DENY_MAC_FILE" \]\] \&\& echo "deny_mac_file=\$DENY_MAC_FILE" >> \$CONFDIR\/hostapd.conf/}' /usr/bin/create_ap
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
/usr/sbin/iw dev wlo1_ap del 2>/dev/null || true

# Step 1: Clear out local DNS system conflicts completely
/usr/bin/systemctl stop dnsmasq 2>/dev/null || true
/usr/bin/systemctl stop systemd-resolved 2>/dev/null || true
/usr/bin/fuser -k 53/udp 53/tcp 67/udp 2>/dev/null || true

# Step-2: Stop Fedora's firewall from blocking DHCP/DNS traffic
/usr/bin/systemctl stop firewalld 2>/dev/null || true

# Step 3: Setup Max Clients and Deny MAC File in environment
if [ "$MAX_CLIENTS" -ne "0" ] 2>/dev/null; then
    export MAX_NUM_STA="$MAX_CLIENTS"
else
    unset MAX_NUM_STA
fi

export DENY_MAC_FILE="/home/$USER_NAME/.config/wifi-hotspot.deny"
touch "$DENY_MAC_FILE"

# Step 4: Kernel-level network performance tuning
/usr/sbin/sysctl -w net.core.netdev_max_backlog=5000 2>/dev/null || true
/usr/sbin/sysctl -w net.ipv4.tcp_fastopen=3 2>/dev/null || true
/usr/sbin/sysctl -w net.ipv4.tcp_slow_start_after_idle=0 2>/dev/null || true

# Step 5: Launch Hotspot with maximum speed settings
CMD_ARGS=()

# Enable 802.11n High Throughput mode with 40MHz channel width for maximum speed
CMD_ARGS+=(--ieee80211n --ht_capab '[HT40+][SHORT-GI-20][SHORT-GI-40][RX-STBC1][LDPC][DSSS_CCK-40]')

# Use channel 6 (least congested non-overlapping 2.4GHz channel)
CMD_ARGS+=(-c 6)

# Dynamically detect active internet interface (default gateway route)
INTERNET_IFACE=$(/usr/bin/ip route | grep '^default' | awk '{print $5}' | head -n 1)
if [ -z "$INTERNET_IFACE" ]; then
    INTERNET_IFACE="wlo1"
fi

CMD_ARGS+=(--dhcp-dns 1.1.1.1,8.8.8.8)
CMD_ARGS+=("wlo1" "$INTERNET_IFACE" "$SSID")

if [ "$USE_PASSWORD" = "true" ] && [ -n "$PASSWORD" ] && [ "$PASSWORD" != "none" ]; then
    CMD_ARGS+=("$PASSWORD")
fi

/usr/bin/create_ap "${CMD_ARGS[@]}"
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

# manage_hotspot_clients
sudo tee /usr/local/bin/manage_hotspot_clients > /dev/null <<'EOF'
#!/bin/bash
ACTION="$1"
MAC="$2"
USER_NAME="$3"

DENY_FILE="/home/$USER_NAME/.config/wifi-hotspot.deny"
CTRL_DIR=$(ls -d /tmp/create_ap.*/hostapd_ctrl 2>/dev/null | head -1)
IFACE=$(ip link show | grep -E "ap0|ap1|wlo1_ap" | head -1 | awk -F': ' '{print $2}')

if [ "$ACTION" = "list" ]; then
    if [ -n "$IFACE" ]; then
        MACS=$(/usr/sbin/iw dev "$IFACE" station dump | grep Station | awk '{print $2}')
        for m in $MACS; do
            HOSTNAME=$(cat /tmp/create_ap.*/dnsmasq.leases 2>/dev/null | grep -i "$m" | awk '{print $4}' | head -1)
            if [ -z "$HOSTNAME" ] || [ "$HOSTNAME" = "*" ]; then
                HOSTNAME="Unknown Device"
            fi
            echo "$m|$HOSTNAME"
        done
    fi
elif [ "$ACTION" = "block" ]; then
    HOSTNAME="$4"
    [ -z "$HOSTNAME" ] && HOSTNAME="Unknown Device"
    mkdir -p "/home/$USER_NAME/.config"
    touch "$DENY_FILE"
    if ! grep -q -i "$MAC" "$DENY_FILE"; then
        echo "$MAC|$HOSTNAME" >> "$DENY_FILE"
    fi
    if [ -n "$CTRL_DIR" ]; then
        /usr/bin/hostapd_cli -p "$CTRL_DIR" deny_acl ADD "$MAC" >/dev/null 2>&1
        /usr/bin/hostapd_cli -p "$CTRL_DIR" disassociate "$MAC" >/dev/null 2>&1
    fi
    # Robust iptables blocking
    /usr/sbin/iptables -I INPUT -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true
    /usr/sbin/iptables -I FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true
elif [ "$ACTION" = "unblock" ]; then
    if [ -f "$DENY_FILE" ]; then
        sed -i "/$MAC/Id" "$DENY_FILE"
    fi
    if [ -n "$CTRL_DIR" ]; then
        /usr/bin/hostapd_cli -p "$CTRL_DIR" deny_acl DEL "$MAC" >/dev/null 2>&1
    fi
    /usr/sbin/iptables -D INPUT -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true
    /usr/sbin/iptables -D FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true
elif [ "$ACTION" = "list_blocked" ]; then
    if [ -f "$DENY_FILE" ]; then
        cat "$DENY_FILE"
    fi
fi
EOF
sudo chmod +x /usr/local/bin/manage_hotspot_clients

# hostapd_action.sh - forcefully kicks blocked devices upon connection
sudo tee /usr/local/bin/hostapd_action.sh > /dev/null <<'EOF'
#!/bin/bash
IFACE=$1
EVENT=$2
MAC=$3

if [ "$EVENT" = "AP-STA-CONNECTED" ]; then
    for DENY_FILE in /home/*/.config/wifi-hotspot.deny; do
        if [ -f "$DENY_FILE" ]; then
            if grep -q -i "$MAC" "$DENY_FILE"; then
                CTRL_DIR=$(ls -d /tmp/create_ap.*/hostapd_ctrl 2>/dev/null | head -1)
                /usr/bin/hostapd_cli -p "$CTRL_DIR" disassociate "$MAC" >/dev/null 2>&1
                /usr/sbin/iw dev "$IFACE" station del "$MAC" 2>/dev/null || true
            fi
        fi
    done
fi
EOF
sudo chmod +x /usr/local/bin/hostapd_action.sh

echo "[+] Helper scripts installed."

echo -e "\n=== Phase 4: Installing systemd Service Template ==="
sudo tee /etc/systemd/system/wifi-hotspot@.service > /dev/null <<'EOF'
[Unit]
Description=Wi-Fi Hotspot Service for %i
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/start_hotspot %i
ExecStartPost=/bin/bash -c 'sleep 3; /usr/bin/hostapd_cli -p $(ls -d /tmp/create_ap.*/hostapd_ctrl 2>/dev/null | head -1) -B -a /usr/local/bin/hostapd_action.sh || true'
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

echo -e "\n=== Phase 5.5: Installing Sudoers Rule for manage_hotspot_clients ==="
sudo tee /etc/sudoers.d/wifi-hotspot > /dev/null <<EOF
ALL ALL=(ALL) NOPASSWD: /usr/local/bin/manage_hotspot_clients
EOF
sudo chmod 440 /etc/sudoers.d/wifi-hotspot
echo "[+] Sudoers rule installed."

echo -e "\n=== Phase 6: Unmanaging Virtual Interfaces in NetworkManager ==="
# Tell NetworkManager to ignore wlo1_ap, ap0, and ap1 so they do not show up in the GUI Wi-Fi menu
sudo tee /etc/NetworkManager/conf.d/99-wifi-hotspot-unmanage.conf > /dev/null <<'EOF'
[keyfile]
unmanaged-devices=interface-name:wlo1_ap;interface-name:ap0;interface-name:ap1
EOF
sudo systemctl reload NetworkManager || sudo systemctl restart NetworkManager || true
echo "[+] NetworkManager configured to hide virtual interfaces from GUI."

echo -e "\n=== Phase 7: Deploying GNOME Extension ==="
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
if [ -L "$TARGET_DIR" ] || [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
fi
ln -s "$SOURCE_DIR" "$TARGET_DIR"
echo "[+] Symlink successfully pointing to development workspace directory."

echo -e "\n=== Phase 8: Initialization ==="
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

echo -e "\n=== Phase 9: Activation Guidelines ==="
echo "Please restart GNOME Shell (log out and back in) to apply the changes."
echo "Then enable the extension:"
echo "    gnome-extensions enable $UUID"
echo "=========================================================="
