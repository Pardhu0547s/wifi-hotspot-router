#!/bin/bash

# Exit on error
set -e

# Configuration constraints
UUID="wifi-hotspot-router@pardhu0547s.github.com"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$SUDO_USER" ]; then
    USER_NAME="$SUDO_USER"
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    USER_NAME=$(whoami)
    REAL_HOME="$HOME"
fi
TARGET_DIR="$REAL_HOME/.local/share/gnome-shell/extensions/$UUID"

echo "=== Phase 0: Checking and Installing Dependencies across Linux Distributions ==="
# Detect Package Manager
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

# Ensure essential tools exist
MISSING_TOOLS=()
for tool in hostapd dnsmasq iw iptables ip qrencode glib-compile-schemas python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        MISSING_TOOLS+=("$tool")
    fi
done

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
    echo "[!] Missing tools detected: ${MISSING_TOOLS[*]}"
    echo "[+] Attempting automated installation via $PKG_MGR..."
    case "$PKG_MGR" in
        apt)
            sudo apt-get update -y || true
            sudo apt-get install -y hostapd dnsmasq iw iptables iproute2 qrencode python3 libglib2.0-bin procps
            ;;
        dnf)
            sudo dnf install -y hostapd dnsmasq iw iptables iproute qrencode python3 glib2-devel procps-ng
            ;;
        pacman)
            sudo pacman -Sy --noconfirm hostapd dnsmasq iw iptables iproute2 qrencode python glib2 procps-ng
            ;;
        zypper)
            sudo zypper install -y hostapd dnsmasq iw iptables iproute2 qrencode python3 glib2-devel procps
            ;;
        *)
            echo "[-] Warning: Unknown package manager. Please ensure the following packages are installed manually: ${MISSING_TOOLS[*]}"
            ;;
    esac
else
    echo "[+] All required system tools are present."
fi

# Ensure create_ap is installed
if ! command -v create_ap >/dev/null 2>&1 && [ ! -f "/usr/bin/create_ap" ] && [ ! -f "/usr/local/bin/create_ap" ]; then
    echo "[+] create_ap script not found. Fetching from official upstream repository..."
    if command -v curl >/dev/null 2>&1; then
        sudo curl -sSL https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap -o /usr/bin/create_ap
        sudo chmod +x /usr/bin/create_ap
    elif command -v wget >/dev/null 2>&1; then
        sudo wget -qO /usr/bin/create_ap https://raw.githubusercontent.com/lakinduakash/linux-wifi-hotspot/master/src/scripts/create_ap
        sudo chmod +x /usr/bin/create_ap
    else
        echo "[-] Error: create_ap missing and neither curl nor wget found."
        exit 1
    fi
fi

CREATE_AP_PATH=$(command -v create_ap || echo "/usr/bin/create_ap")
echo "[+] Using create_ap at $CREATE_AP_PATH"

echo -e "\n=== Phase 1: Compiling GSettings Schemas ==="
if [ -d "$SOURCE_DIR/schemas" ]; then
    glib-compile-schemas "$SOURCE_DIR/schemas"
    echo "[+] GSettings schemas compiled successfully."
else
    echo "[-] Error: schemas directory not found."
    exit 1
fi

echo -e "\n=== Phase 2: Restoring and Patching create_ap ==="
if [ -f "${CREATE_AP_PATH}.bak" ]; then
    echo "[+] Restoring $CREATE_AP_PATH from backup..."
    sudo cp "${CREATE_AP_PATH}.bak" "$CREATE_AP_PATH"
else
    echo "[+] Backing up original $CREATE_AP_PATH..."
    sudo cp "$CREATE_AP_PATH" "${CREATE_AP_PATH}.bak"
fi

echo "[+] Patching $CREATE_AP_PATH for Client Limits, MAC Filter, and 5GHz AP support..."
sudo python3 "$SOURCE_DIR/patch_create_ap.py" "$CREATE_AP_PATH"
echo "[+] $CREATE_AP_PATH successfully patched."

echo -e "\n=== Phase 3: Installing Universal Network Engine (start_hotspot & stop_hotspot) ==="
# start_hotspot
sudo tee /usr/local/bin/start_hotspot > /dev/null <<\EOF_START
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
BAND="bg"
DNS_PROFILE="system"
SECURITY_MODE="wpa2"
ISOLATE_CLIENTS="false"
IDLE_TIMEOUT="0"
INHIBIT_SLEEP="false"

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

# Locate core tools dynamically
IW_BIN=$(command -v iw || echo "/usr/sbin/iw")
IP_BIN=$(command -v ip || echo "/usr/bin/ip")
NMCLI_BIN=$(command -v nmcli || echo "/usr/bin/nmcli")
SYSCTL_BIN=$(command -v sysctl || echo "/usr/sbin/sysctl")
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
SYSTEMCTL_BIN=$(command -v systemctl || echo "/usr/bin/systemctl")
CREATE_AP_BIN=$(command -v create_ap || echo "/usr/bin/create_ap")

# 1. Detect all available Wi-Fi interfaces
mapfile -t WIFI_INTERFACES < <($IW_BIN dev 2>/dev/null | awk '$1=="Interface"{print $2}' | grep -v '_ap$' | grep -v '^ap[0-9]')

if [ ${#WIFI_INTERFACES[@]} -eq 0 ]; then
    echo "Error: No Wi-Fi interface found."
    exit 1
fi

# 2. Detect if any Wi-Fi interface is actively connected to an external network
IS_WIFI_CONNECTED=0
ACTIVE_WIFI_IFACE=""
for w in "${WIFI_INTERFACES[@]}"; do
    if $IW_BIN dev "$w" link 2>/dev/null | grep -q "^Connected to" || \
       ($NMCLI_BIN -t -f DEVICE,STATE dev 2>/dev/null | grep -E "^$w:connected" >/dev/null 2>&1); then
        IS_WIFI_CONNECTED=1
        ACTIVE_WIFI_IFACE="$w"
        break
    fi
done

# Detect default internet interface and route
DEFAULT_ROUTE=$($IP_BIN route show default 2>/dev/null | head -n 1)
DEFAULT_IFACE=$(echo "$DEFAULT_ROUTE" | awk '{print $5}')

# If NOT repeating an active Wi-Fi connection, clean up previous create_ap instances
if [ "$IS_WIFI_CONNECTED" -eq 0 ]; then
    for w in "${WIFI_INTERFACES[@]}"; do
        $CREATE_AP_BIN --stop "$w" 2>/dev/null || true
        $IW_BIN dev "${w}_ap" del 2>/dev/null || true
    done
fi
$IW_BIN dev ap0 del 2>/dev/null || true
$IW_BIN dev ap1 del 2>/dev/null || true

# 3. Stop conflicting standalone dnsmasq service (if present)
$SYSTEMCTL_BIN stop dnsmasq 2>/dev/null || true

# 4. Universal Firewall Handling across distributions
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qw "active"; then
    ufw allow in on ap0 2>/dev/null || true
    ufw route allow in on ap0 2>/dev/null || true
fi

if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -qw "running"; then
    firewall-cmd --zone=trusted --add-interface=ap0 2>/dev/null || true
fi

# 5. Kernel-level network performance and gigabit IP forwarding tuning
$SYSCTL_BIN -w net.ipv4.ip_forward=1 2>/dev/null || true
$SYSCTL_BIN -w net.core.netdev_max_backlog=10000 2>/dev/null || true
$SYSCTL_BIN -w net.core.rmem_max=16777216 2>/dev/null || true
$SYSCTL_BIN -w net.core.wmem_max=16777216 2>/dev/null || true
$SYSCTL_BIN -w net.core.rmem_default=262144 2>/dev/null || true
$SYSCTL_BIN -w net.core.wmem_default=262144 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_rmem="4096 87380 16777216" 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_wmem="4096 65536 16777216" 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_fastopen=3 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_slow_start_after_idle=0 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_window_scaling=1 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_timestamps=1 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_sack=1 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.tcp_no_metrics_save=1 2>/dev/null || true
$SYSCTL_BIN -w net.ipv4.ip_no_pmtu_disc=0 2>/dev/null || true

# TCP MSS Clamping to eliminate PMTU packet fragmentation and unlock maximum throughput
$IPTABLES_BIN -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
    $IPTABLES_BIN -t mangle -I FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
$IPTABLES_BIN -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
    $IPTABLES_BIN -t mangle -I POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

# 6. Setup Max Clients and Deny MAC File in environment
if [ "$MAX_CLIENTS" -ne "0" ] 2>/dev/null; then
    export MAX_NUM_STA="$MAX_CLIENTS"
else
    unset MAX_NUM_STA
fi

UI_DENY_FILE="/home/$USER_NAME/.config/wifi-hotspot.deny"
touch "$UI_DENY_FILE"
export DENY_MAC_FILE="/home/$USER_NAME/.config/wifi-hotspot-hostapd.deny"
awk -F'|' '{print $1}' "$UI_DENY_FILE" | grep -E '^[0-9a-fA-F:]+$' > "$DENY_MAC_FILE" 2>/dev/null || true
touch "$DENY_MAC_FILE"

# Apply iptables DROP rules for all previously blocked MACs
while IFS= read -r blocked_mac; do
    if [ -n "$blocked_mac" ]; then
        $IPTABLES_BIN -C FORWARD -m mac --mac-source "$blocked_mac" -j DROP 2>/dev/null || \
            $IPTABLES_BIN -I FORWARD -m mac --mac-source "$blocked_mac" -j DROP 2>/dev/null || true
    fi
done < "$DENY_MAC_FILE"

# 7. Regulatory Domain Management
CURRENT_REG=$($IW_BIN reg get 2>/dev/null | awk '/country/{print $2}' | tr -d ':' | head -n 1)
if [ "$CURRENT_REG" = "00" ] || [ -z "$CURRENT_REG" ]; then
    LOCALE_COUNTRY=$(locale | grep -m1 LC_NAME | cut -d_ -f2 | cut -d. -f1 | cut -d@ -f1)
    [ -z "$LOCALE_COUNTRY" ] && LOCALE_COUNTRY=$(locale | grep -m1 LANG | cut -d_ -f2 | cut -d. -f1 | cut -d@ -f1)
    if [ ${#LOCALE_COUNTRY} -eq 2 ]; then
        $IW_BIN reg set "$LOCALE_COUNTRY" 2>/dev/null || true
    else
        $IW_BIN reg set IN 2>/dev/null || true
    fi
fi

CMD_ARGS=(--ieee80211n)
MODE_LABEL="2.4G"

# Hardware-accelerated High-Throughput capabilities
HT_CAPAB_OPTS='[HT40+][SHORT-GI-20][SHORT-GI-40][RX-STBC1][LDPC]'
VHT_CAPAB_OPTS='[SHORT-GI-80][MAX-A-MPDU-LEN-EXP7][RXLDPC][RX-STBC-1][TX-STBC-2BY1]'

# Check if Wi-Fi hardware supports IEEE 802.11ax (HE) AP mode
HAS_AX=0
if [ ${#WIFI_INTERFACES[@]} -gt 0 ]; then
    PHY_NAME=$($IW_BIN dev "${WIFI_INTERFACES[0]}" info 2>/dev/null | awk '/wiphy/{print "phy"$2}')
    if [ -n "$PHY_NAME" ] && $IW_BIN phy "$PHY_NAME" info 2>/dev/null | grep -A 5 "HE Iftypes" | grep -qw "AP"; then
        HAS_AX=1
    fi
fi

if [ "$IS_WIFI_CONNECTED" -eq 1 ]; then
    # =========================================================================
    # SCENARIO B: Connected to Wi-Fi (Wi-Fi Repeater / Hotspot while on Wi-Fi)
    # Also seamlessly handles VPN active over Wi-Fi (tun*, wg*, tap*)!
    # CRITICAL: DO NOT DISCONNECT WI-FI!
    # =========================================================================
    INTERNET_IFACE="$DEFAULT_IFACE"
    [ -z "$INTERNET_IFACE" ] && INTERNET_IFACE="$ACTIVE_WIFI_IFACE"
    
    if [ ${#WIFI_INTERFACES[@]} -ge 2 ]; then
        # Subcase B1: Multiple Wi-Fi adapters available
        for w in "${WIFI_INTERFACES[@]}"; do
            if [ "$w" != "$ACTIVE_WIFI_IFACE" ]; then
                WIFI_IFACE="$w"
                break
            fi
        done
        [ -z "$WIFI_IFACE" ] && WIFI_IFACE="${WIFI_INTERFACES[0]}"

        # Check if 5GHz transmission is permitted (free of "no IR")
        ALLOWED_5G_CHAN=""
        if [ -n "$PHY_NAME" ]; then
            ALLOWED_5G_CHAN=$($IW_BIN phy "$PHY_NAME" info 2>/dev/null | grep -E "5[0-9]{3}\.0 MHz" | grep -v "disabled" | sed -n 's/.*\[\([0-9]\+\)\].*/\1/p' | head -n 1 || true)
            [ -z "$ALLOWED_5G_CHAN" ] && ALLOWED_5G_CHAN="36"
        fi
        if [ "$BAND" = "a" ] && [ -n "$ALLOWED_5G_CHAN" ]; then
            CMD_ARGS+=(--ieee80211ac -c "$ALLOWED_5G_CHAN" --freq-band 5 --ht_capab "$HT_CAPAB_OPTS" --vht_capab "$VHT_CAPAB_OPTS")
            [ "$HAS_AX" -eq 1 ] && CMD_ARGS+=(--ieee80211ax)
            MODE_LABEL="5G"
        else
            CMD_ARGS+=(-c 6 --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
            MODE_LABEL="2.4G"
        fi
    else
        # Subcase B2: Single physical Wi-Fi adapter (STA + AP concurrent mode)
        WIFI_IFACE="$ACTIVE_WIFI_IFACE"
        
        # Read the channel the Wi-Fi card is currently connected to
        CURRENT_CHAN=$($IW_BIN dev "$WIFI_IFACE" info 2>/dev/null | awk '/channel/{print $2}')
        if [ -z "$CURRENT_CHAN" ]; then
            CURRENT_CHAN=$($NMCLI_BIN -t -f active,chan dev wifi 2>/dev/null | grep '^yes:' | cut -d: -f2 | head -n 1)
        fi
        [ -z "$CURRENT_CHAN" ] && CURRENT_CHAN=6
        
        # Match channel and band to current Wi-Fi connection
        if [ "$CURRENT_CHAN" -ge 36 ] 2>/dev/null; then
            CMD_ARGS+=(--ieee80211ac -c "$CURRENT_CHAN" --freq-band 5 --ht_capab "$HT_CAPAB_OPTS" --vht_capab "$VHT_CAPAB_OPTS")
            [ "$HAS_AX" -eq 1 ] && CMD_ARGS+=(--ieee80211ax)
            MODE_LABEL="Repeater 5G"
        else
            CMD_ARGS+=(-c "$CURRENT_CHAN" --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
            MODE_LABEL="Repeater 2.4G"
        fi
    fi

elif [ -n "$DEFAULT_IFACE" ]; then
    # =========================================================================
    # SCENARIO A: Ethernet / USB Tethering / Cellular / Standalone VPN (LAN active)
    # =========================================================================
    WIFI_IFACE="${WIFI_INTERFACES[0]}"
    INTERNET_IFACE="$DEFAULT_IFACE"
    
    # Wi-Fi radio is not connected to external network, ensure interface is clean
    $NMCLI_BIN dev disconnect "$WIFI_IFACE" 2>/dev/null || true
    sleep 0.5
    
    if [ "$BAND" = "a" ]; then
        # Check if 5GHz transmission is permitted (free of "no IR")
        ALLOWED_5G_CHAN=""
        if [ -n "$PHY_NAME" ]; then
            ALLOWED_5G_CHAN=$($IW_BIN phy "$PHY_NAME" info 2>/dev/null | grep -E "5[0-9]{3}\.0 MHz" | grep -v "disabled" | sed -n 's/.*\[\([0-9]\+\)\].*/\1/p' | head -n 1 || true)
            [ -z "$ALLOWED_5G_CHAN" ] && ALLOWED_5G_CHAN="36"
        fi
        if [ -n "$ALLOWED_5G_CHAN" ]; then
            CMD_ARGS+=(--ieee80211ac -c "$ALLOWED_5G_CHAN" --freq-band 5 --ht_capab "$HT_CAPAB_OPTS" --vht_capab "$VHT_CAPAB_OPTS")
            [ "$HAS_AX" -eq 1 ] && CMD_ARGS+=(--ieee80211ax)
            MODE_LABEL="5G"
        else
            echo "[!] Notice: 5GHz Initiate-Radiation (IR) is restricted on this wireless adapter without active Wi-Fi association."
            echo "[!] Gracefully starting hotspot on high-speed 2.4GHz (Channel 6)..."
            CMD_ARGS+=(-c 6 --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
            MODE_LABEL="2.4G (5G NO-IR fallback)"
        fi
    else
        CMD_ARGS+=(-c 6 --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
        MODE_LABEL="2.4G"
    fi

else
    # =========================================================================
    # SCENARIO C: Offline mode (No internet route / Local Network)
    # =========================================================================
    WIFI_IFACE="${WIFI_INTERFACES[0]}"
    INTERNET_IFACE="$WIFI_IFACE"
    
    if [ "$BAND" = "a" ]; then
        ALLOWED_5G_CHAN=""
        if [ -n "$PHY_NAME" ]; then
            ALLOWED_5G_CHAN=$($IW_BIN phy "$PHY_NAME" info 2>/dev/null | grep -E "5[0-9]{3}\.0 MHz" | grep -v "disabled" | sed -n 's/.*\[\([0-9]\+\)\].*/\1/p' | head -n 1 || true)
            [ -z "$ALLOWED_5G_CHAN" ] && ALLOWED_5G_CHAN="36"
        fi
        if [ -n "$ALLOWED_5G_CHAN" ]; then
            CMD_ARGS+=(--ieee80211ac -c "$ALLOWED_5G_CHAN" --freq-band 5 --ht_capab "$HT_CAPAB_OPTS" --vht_capab "$VHT_CAPAB_OPTS")
            [ "$HAS_AX" -eq 1 ] && CMD_ARGS+=(--ieee80211ax)
            MODE_LABEL="5G"
        else
            echo "[!] Notice: 5GHz Initiate-Radiation (IR) is restricted on this wireless adapter."
            echo "[!] Gracefully starting hotspot on high-speed 2.4GHz (Channel 6)..."
            CMD_ARGS+=(-c 6 --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
            MODE_LABEL="2.4G (5G NO-IR fallback)"
        fi
    else
        CMD_ARGS+=(-c 6 --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
        MODE_LABEL="2.4G"
    fi
fi

# Store active mode label for GNOME Shell UI
echo "$MODE_LABEL" > /tmp/wifi-hotspot-active-mode 2>/dev/null || true

# Configure upstream DNS servers based on profile
DNS_SERVERS=""
case "$DNS_PROFILE" in
    adguard)
        DNS_SERVERS="94.140.14.14,94.140.15.15"
        ;;
    quad9)
        DNS_SERVERS="9.9.9.9,149.112.112.112"
        ;;
    google)
        DNS_SERVERS="8.8.8.8,8.8.4.4"
        ;;
    cloudflare)
        DNS_SERVERS="1.1.1.1,8.8.8.8"
        ;;
    system|disabled|none|*)
        DNS_SERVERS=""
        ;;
esac

if [ -n "$DNS_SERVERS" ]; then
    CMD_ARGS+=(--dhcp-dns "$DNS_SERVERS")
fi

# Security Mode Handling
if [ "$USE_PASSWORD" = "true" ]; then
    if [ "$SECURITY_MODE" = "wpa3" ] || [ "$SECURITY_MODE" = "wpa3-only" ]; then
        CMD_ARGS+=(-w 3-only)
    elif [ "$SECURITY_MODE" = "wpa3-mixed" ]; then
        CMD_ARGS+=(-w 3)
    else
        CMD_ARGS+=(-w 2)
    fi
fi

# Optional Client Isolation
if [ "$ISOLATE_CLIENTS" = "true" ]; then
    CMD_ARGS+=(--isolate-clients)
fi

CMD_ARGS+=("$WIFI_IFACE" "$INTERNET_IFACE" "$SSID")

if [ "$USE_PASSWORD" = "true" ] && [ -n "$PASSWORD" ] && [ "$PASSWORD" != "none" ]; then
    CMD_ARGS+=("$PASSWORD")
fi

# Clean up any leftover virtual interface before launch
$IW_BIN dev ap0 del 2>/dev/null || true

# Execute create_ap with resilient auto-fallback
$CREATE_AP_BIN "${CMD_ARGS[@]}"
EXIT_CODE=$?

# If create_ap exited with error and 5GHz was requested, automatically recover on 2.4GHz!
if [ $EXIT_CODE -ne 0 ] && [ "$BAND" = "a" ]; then
    echo "[!] 5GHz startup returned exit code $EXIT_CODE. Automatically recovering on 2.4GHz..."
    echo "2.4G (Auto-Fallback)" > /tmp/wifi-hotspot-active-mode 2>/dev/null || true
    $IW_BIN dev ap0 del 2>/dev/null || true
    sleep 1

    FALLBACK_ARGS=(--ieee80211n -c 6 --freq-band 2.4 --ht_capab "$HT_CAPAB_OPTS")
    [ -n "$DNS_SERVERS" ] && FALLBACK_ARGS+=(--dhcp-dns "$DNS_SERVERS")
    if [ "$USE_PASSWORD" = "true" ]; then
        if [ "$SECURITY_MODE" = "wpa3" ] || [ "$SECURITY_MODE" = "wpa3-only" ]; then
            FALLBACK_ARGS+=(-w 3-only)
        elif [ "$SECURITY_MODE" = "wpa3-mixed" ]; then
            FALLBACK_ARGS+=(-w 3)
        else
            FALLBACK_ARGS+=(-w 2)
        fi
    fi
    [ "$ISOLATE_CLIENTS" = "true" ] && FALLBACK_ARGS+=(--isolate-clients)
    FALLBACK_ARGS+=("$WIFI_IFACE" "$INTERNET_IFACE" "$SSID")
    if [ "$USE_PASSWORD" = "true" ] && [ -n "$PASSWORD" ] && [ "$PASSWORD" != "none" ]; then
        FALLBACK_ARGS+=("$PASSWORD")
    fi
    exec $CREATE_AP_BIN "${FALLBACK_ARGS[@]}"
fi

exit $EXIT_CODE
EOF_START
sudo chmod +x /usr/local/bin/start_hotspot

# stop_hotspot
sudo tee /usr/local/bin/stop_hotspot > /dev/null <<\EOF_STOP
#!/bin/bash
IW_BIN=$(command -v iw || echo "/usr/sbin/iw")
CREATE_AP_BIN=$(command -v create_ap || echo "/usr/bin/create_ap")
NMCLI_BIN=$(command -v nmcli || echo "/usr/bin/nmcli")

for w in $($IW_BIN dev 2>/dev/null | awk '$1=="Interface"{print $2}' | grep -v '_ap$' | grep -v '^ap[0-9]'); do
    $CREATE_AP_BIN --stop "$w" 2>/dev/null || true
    $IW_BIN dev "${w}_ap" del 2>/dev/null || true
    $NMCLI_BIN dev set "$w" managed yes 2>/dev/null || true
done

$IW_BIN dev ap0 del 2>/dev/null || true
$IW_BIN dev ap1 del 2>/dev/null || true

# UFW cleanup
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qw "active"; then
    ufw route delete allow in on ap0 2>/dev/null || true
    ufw delete allow in on ap0 2>/dev/null || true
fi

# Firewalld cleanup
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -qw "running"; then
    firewall-cmd --zone=trusted --remove-interface=ap0 2>/dev/null || true
fi

# TCP MSS Clamping cleanup
iptables -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

# Traffic shaping cleanup
tc qdisc del dev ap0 root 2>/dev/null || true
tc qdisc del dev ap1 root 2>/dev/null || true

rm -f /tmp/wifi-hotspot-active-mode 2>/dev/null || true
EOF_STOP
sudo chmod +x /usr/local/bin/stop_hotspot

# manage_hotspot_clients
sudo tee /usr/local/bin/manage_hotspot_clients > /dev/null <<\EOF_MANAGE
#!/bin/bash
ACTION="$1"
MAC="$2"
USER_NAME="$3"

IW_BIN=$(command -v iw || echo "/usr/sbin/iw")
IP_BIN=$(command -v ip || echo "/usr/bin/ip")
TC_BIN=$(command -v tc || echo "/usr/sbin/tc")
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
HOSTAPD_CLI_BIN=$(command -v hostapd_cli || echo "/usr/sbin/hostapd_cli")

DENY_FILE="/home/$USER_NAME/.config/wifi-hotspot.deny"
CTRL_DIR=$(ls -d /tmp/create_ap.*/hostapd_ctrl 2>/dev/null | head -1)
IFACE=$($IP_BIN link show 2>/dev/null | grep -E "ap[0-9]+|_ap" | grep -i "UP" | head -1 | awk -F': ' '{print $2}' | awk '{print $1}')
[ -z "$IFACE" ] && IFACE=$($IP_BIN link show 2>/dev/null | grep -E "ap[0-9]+|_ap" | head -1 | awk -F': ' '{print $2}' | awk '{print $1}')

apply_traffic_limits() {
    local USER="$1"
    local LIMITS_FILE="/home/$USER/.config/wifi-hotspot-limits.conf"
    local AP_IFACE=$($IP_BIN link show 2>/dev/null | grep -E "ap[0-9]+|_ap" | grep -i "UP" | head -1 | awk -F': ' '{print $2}' | awk '{print $1}')
    [ -z "$AP_IFACE" ] && AP_IFACE=$($IP_BIN link show 2>/dev/null | grep -E "ap[0-9]+|_ap" | head -1 | awk -F': ' '{print $2}' | awk '{print $1}')
    [ -z "$AP_IFACE" ] && return 0

    if [ ! -f "$LIMITS_FILE" ] || [ ! -s "$LIMITS_FILE" ]; then
        $TC_BIN qdisc del dev "$AP_IFACE" root 2>/dev/null || true
        return 0
    fi

    local LEASES_FILE=$(ls /tmp/create_ap.*/dnsmasq.leases 2>/dev/null | head -1)
    [ -z "$LEASES_FILE" ] && return 0

    # Initialize root HTB qdisc and unthrottled line-rate default class (10 Gbps maximum headroom)
    $TC_BIN qdisc add dev "$AP_IFACE" root handle 1: htb default 10 r2q 100 2>/dev/null || true
    $TC_BIN class replace dev "$AP_IFACE" parent 1: classid 1:10 htb rate 10000mbit ceil 10000mbit quantum 1500 2>/dev/null || true

    # Clear existing filters on root
    $TC_BIN filter del dev "$AP_IFACE" parent 1: 2>/dev/null || true

    local CLASS_ID=100
    local ACTIVE_COUNT=0
    while IFS='|' read -r mac rate || [ -n "$mac" ]; do
        mac=$(echo "$mac" | tr '[:upper:]' '[:lower:]' | xargs)
        rate=$(echo "$rate" | xargs)
        if [ -n "$mac" ] && [ -n "$rate" ] && [ "$rate" -gt 0 ] 2>/dev/null; then
            ip=$(grep -i "$mac" "$LEASES_FILE" 2>/dev/null | awk '{print $3}' | head -1)
            if [ -n "$ip" ]; then
                CLASS_ID=$((CLASS_ID + 1))
                $TC_BIN class replace dev "$AP_IFACE" parent 1: classid "1:$CLASS_ID" htb rate "${rate}mbit" ceil "${rate}mbit" quantum 1500 2>/dev/null || true
                $TC_BIN filter replace dev "$AP_IFACE" protocol ip parent 1: prio 1 u32 match ip dst "$ip/32" flowid "1:$CLASS_ID" 2>/dev/null || true
                ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
            fi
        fi
    done < "$LIMITS_FILE"

    if [ "$ACTIVE_COUNT" -eq 0 ]; then
        $TC_BIN qdisc del dev "$AP_IFACE" root 2>/dev/null || true
    fi
}

if [ "$ACTION" = "list" ]; then
    if [ -n "$IFACE" ]; then
        MACS=$($IW_BIN dev "$IFACE" station dump 2>/dev/null | grep Station | awk '{print $2}')
        for m in $MACS; do
            if grep -q -i "$m" "$DENY_FILE" 2>/dev/null; then
                continue
            fi
            LEASE_LINE=$(cat /tmp/create_ap.*/dnsmasq.leases 2>/dev/null | grep -i "$m" | head -1)
            IP=$(echo "$LEASE_LINE" | awk '{print $3}')
            HOSTNAME=$(echo "$LEASE_LINE" | awk '{print $4}')
            if [ -z "$HOSTNAME" ] || [ "$HOSTNAME" = "*" ]; then
                HOSTNAME="Unknown Device"
            fi
            [ -z "$IP" ] && IP="Unknown IP"
            RX=$($IW_BIN dev "$IFACE" station get "$m" 2>/dev/null | awk '/rx bytes:/{print $3}')
            TX=$($IW_BIN dev "$IFACE" station get "$m" 2>/dev/null | awk '/tx bytes:/{print $3}')
            BITRATE=$($IW_BIN dev "$IFACE" station get "$m" 2>/dev/null | awk -F':\t' '/tx bitrate:/{print $2}' | awk '{print $1" "$2}')
            [ -z "$RX" ] && RX=0
            [ -z "$TX" ] && TX=0
            [ -z "$BITRATE" ] && BITRATE=""
            echo "$m|$HOSTNAME|$RX|$TX|$BITRATE|$IP"
        done
    fi
elif [ "$ACTION" = "set_limit" ]; then
    RATE="$4"
    LIMITS_FILE="/home/$USER_NAME/.config/wifi-hotspot-limits.conf"
    mkdir -p "/home/$USER_NAME/.config"
    touch "$LIMITS_FILE"
    if [ -f "$LIMITS_FILE" ]; then
        sed -i "/^$MAC|/Id" "$LIMITS_FILE"
    fi
    if [ -n "$RATE" ] && [ "$RATE" -gt 0 ] 2>/dev/null; then
        echo "$MAC|$RATE" >> "$LIMITS_FILE"
    fi
    apply_traffic_limits "$USER_NAME"
elif [ "$ACTION" = "get_limits" ]; then
    LIMITS_FILE="/home/$USER_NAME/.config/wifi-hotspot-limits.conf"
    if [ -f "$LIMITS_FILE" ]; then
        cat "$LIMITS_FILE"
    fi
elif [ "$ACTION" = "apply_limits" ]; then
    apply_traffic_limits "$USER_NAME"
elif [ "$ACTION" = "block" ]; then
    HOSTNAME="$4"
    [ -z "$HOSTNAME" ] && HOSTNAME="Unknown Device"
    mkdir -p "/home/$USER_NAME/.config"
    touch "$DENY_FILE"
    if ! grep -q -i "$MAC" "$DENY_FILE"; then
        echo "$MAC|$HOSTNAME" >> "$DENY_FILE"
    fi
    HOSTAPD_DENY="/home/$USER_NAME/.config/wifi-hotspot-hostapd.deny"
    awk -F'|' '{print $1}' "$DENY_FILE" | grep -E '^[0-9a-fA-F:]+$' > "$HOSTAPD_DENY" 2>/dev/null || true
    if [ -n "$CTRL_DIR" ]; then
        $HOSTAPD_CLI_BIN -p "$CTRL_DIR" deny_acl ADD "$MAC" >/dev/null 2>&1 || true
        $HOSTAPD_CLI_BIN -p "$CTRL_DIR" deauthenticate "$MAC" >/dev/null 2>&1 || true
        $HOSTAPD_CLI_BIN -p "$CTRL_DIR" disassociate "$MAC" >/dev/null 2>&1 || true
    fi
    $IPTABLES_BIN -C FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null || \
        $IPTABLES_BIN -I FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true
    $IPTABLES_BIN -C INPUT -m mac --mac-source "$MAC" -j DROP 2>/dev/null || \
        $IPTABLES_BIN -I INPUT -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true

    if [ -n "$IFACE" ]; then
        $IW_BIN dev "$IFACE" station del "$MAC" 2>/dev/null || true
    fi

elif [ "$ACTION" = "unblock" ]; then
    if [ -f "$DENY_FILE" ]; then
        sed -i "/$MAC/Id" "$DENY_FILE"
    fi
    HOSTAPD_DENY="/home/$USER_NAME/.config/wifi-hotspot-hostapd.deny"
    awk -F'|' '{print $1}' "$DENY_FILE" | grep -E '^[0-9a-fA-F:]+$' > "$HOSTAPD_DENY" 2>/dev/null || true
    touch "$HOSTAPD_DENY"
    if [ -n "$CTRL_DIR" ]; then
        $HOSTAPD_CLI_BIN -p "$CTRL_DIR" deny_acl DEL "$MAC" >/dev/null 2>&1 || true
    fi

    while $IPTABLES_BIN -D INPUT -m mac --mac-source "$MAC" -j DROP 2>/dev/null; do :; done
    while $IPTABLES_BIN -D FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null; do :; done
elif [ "$ACTION" = "list_blocked" ]; then
    if [ -f "$DENY_FILE" ]; then
        cat "$DENY_FILE"
    fi
fi
EOF_MANAGE
sudo chmod +x /usr/local/bin/manage_hotspot_clients

# hostapd_action.sh
sudo tee /usr/local/bin/hostapd_action.sh > /dev/null <<\EOF_ACTION
#!/bin/bash
IFACE=$1
EVENT=$2
MAC=$3

IW_BIN=$(command -v iw || echo "/usr/sbin/iw")
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
HOSTAPD_CLI_BIN=$(command -v hostapd_cli || echo "/usr/sbin/hostapd_cli")

if [ "$EVENT" = "AP-STA-CONNECTED" ]; then
    for USER_DIR in /home/*; do
        [ ! -d "$USER_DIR" ] && continue
        USER_NAME=$(basename "$USER_DIR")
        DENY_FILE="$USER_DIR/.config/wifi-hotspot.deny"
        if [ -f "$DENY_FILE" ] && grep -q -i "$MAC" "$DENY_FILE"; then
            CTRL_DIR=$(ls -d /tmp/create_ap.*/hostapd_ctrl 2>/dev/null | head -1)
            $HOSTAPD_CLI_BIN -p "$CTRL_DIR" deauthenticate "$MAC" >/dev/null 2>&1 || true
            $HOSTAPD_CLI_BIN -p "$CTRL_DIR" disassociate "$MAC" >/dev/null 2>&1 || true
            $IW_BIN dev "$IFACE" station del "$MAC" 2>/dev/null || true
            $IPTABLES_BIN -C FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null || \
                $IPTABLES_BIN -I FORWARD -m mac --mac-source "$MAC" -j DROP 2>/dev/null || true
        else
            /usr/local/bin/manage_hotspot_clients apply_limits "" "$USER_NAME" >/dev/null 2>&1 || true
        fi
    done
fi
EOF_ACTION
sudo chmod +x /usr/local/bin/hostapd_action.sh

echo "[+] Helper scripts installed."

echo -e "\n=== Phase 4: Installing systemd Service Template ==="
sudo tee /etc/systemd/system/wifi-hotspot@.service > /dev/null <<\EOF_SERVICE
[Unit]
Description=Wi-Fi Hotspot Service for %i
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/start_hotspot %i
ExecStartPost=/bin/bash -c 'sleep 2; /usr/bin/ip link set dev ap0 txqueuelen 5000 2>/dev/null || true; /usr/local/bin/manage_hotspot_clients apply_limits "" %i 2>/dev/null || true; CTRL=$(ls -d /tmp/create_ap.*/hostapd_ctrl 2>/dev/null | head -1); [ -n "$CTRL" ] && hostapd_cli -p "$CTRL" -B -a /usr/local/bin/hostapd_action.sh || true'
ExecStop=/usr/local/bin/stop_hotspot %i
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF_SERVICE
sudo systemctl daemon-reload
echo "[+] systemd service template installed."

echo -e "\n=== Phase 5: Installing Dual Polkit Authorization Rules ==="
# Modern JavaScript Polkit (polkit >= 0.106: Ubuntu 23+, Debian 12+, Fedora, Arch)
if [ -d "/etc/polkit-1/rules.d" ]; then
    sudo tee /etc/polkit-1/rules.d/99-wifi-hotspot.rules > /dev/null <<\EOF_RULES
polkit.addRule(function(action, subject, context) {
    if (action.id == "org.freedesktop.systemd1.manage-units" &&
        action.lookup("unit") && action.lookup("unit").match(/^wifi-hotspot@.*\.service$/)) {
        return polkit.Result.YES;
    }
});
EOF_RULES
    echo "[+] Modern Polkit rule installed."
fi

# Legacy Keyfile Polkit (polkit < 0.106: Ubuntu 20.04/22.04, Debian 10/11, CentOS 7/8)
if [ -d "/etc/polkit-1/localauthority/50-local.d" ]; then
    sudo tee /etc/polkit-1/localauthority/50-local.d/99-wifi-hotspot.pkla > /dev/null <<\EOF_PKLA
[Allow Hotspot Service Management]
Identity=unix-user:*
Action=org.freedesktop.systemd1.manage-units
ResultAny=yes
ResultInactive=yes
ResultActive=yes
EOF_PKLA
    echo "[+] Legacy Polkit pkla rule installed."
fi

echo -e "\n=== Phase 5.5: Installing Sudoers Rule for manage_hotspot_clients ==="
sudo tee /etc/sudoers.d/wifi-hotspot > /dev/null <<\EOF_SUDO
ALL ALL=(ALL) NOPASSWD: /usr/local/bin/manage_hotspot_clients
EOF_SUDO
sudo chmod 440 /etc/sudoers.d/wifi-hotspot
echo "[+] Sudoers rule installed."

echo -e "\n=== Phase 6: Unmanaging Virtual Interfaces in NetworkManager ==="
sudo tee /etc/NetworkManager/conf.d/99-wifi-hotspot-unmanage.conf > /dev/null <<\EOF_NM
[keyfile]
unmanaged-devices=interface-name:*_ap;interface-name:ap0;interface-name:ap1;interface-name:vmnet*
EOF_NM

# Ensure no conflicting udev cleanup rule interferes with interface creation
sudo rm -f /etc/udev/rules.d/99-wifi-hotspot-cleanup.rules 2>/dev/null || true
sudo udevadm control --reload-rules 2>/dev/null || true

sudo systemctl reload NetworkManager 2>/dev/null || sudo systemctl restart NetworkManager 2>/dev/null || true
echo "[+] NetworkManager unmanaged configuration installed."

echo -e "\n=== Phase 7: Deploying GNOME Extension ==="
mkdir -p "$REAL_HOME/.local/share/gnome-shell/extensions"
if [ -L "$TARGET_DIR" ] || [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
fi
ln -s "$SOURCE_DIR" "$TARGET_DIR"
echo "[+] Symlink successfully pointing to development workspace directory."

echo -e "\n=== Phase 8: Initialization ==="
CONFIG_DEST="$REAL_HOME/.config/wifi-hotspot.conf"
if [ ! -f "$CONFIG_DEST" ]; then
    echo "[+] Creating default config at $CONFIG_DEST..."
    cat <<\EOF_CONF > "$CONFIG_DEST"
SSID="hotspot"
USE_PASSWORD="true"
PASSWORD="12345678"
MAX_CLIENTS="10"
BAND="a"
EOF_CONF
    chmod 600 "$CONFIG_DEST"
fi

echo -e "\n=== Phase 9: Activation Guidelines ==="
echo "Installation completed successfully."
echo "Enable the extension with:"
echo "    gnome-extensions enable $UUID"
echo "=========================================================="
