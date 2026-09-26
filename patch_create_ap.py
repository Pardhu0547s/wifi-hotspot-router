#!/usr/bin/env python3
"""Patch create_ap for wifi-hotspot-router extension across all Linux distributions.

Applies two patches:
1. Client Limits & MAC Filter: Adds MAX_NUM_STA and DENY_MAC_FILE support
   to hostapd.conf generation.
2. 5GHz IR-CONCURRENT AP: Comments out the 'no IR' check that blocks 5GHz AP
   on Intel/other WiFi cards with self-managed regulatory domains.
"""

import sys
import os
import shutil

filepath = sys.argv[1] if len(sys.argv) > 1 else (shutil.which('create_ap') or '/usr/bin/create_ap')

if not os.path.isfile(filepath):
    print(f"[-] Error: create_ap binary not found at {filepath}")
    sys.exit(1)

print(f"[+] Patching {filepath}...")

with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Patch 1: Add MAX_NUM_STA and DENY_MAC_FILE support after hostapd.conf EOF
patch1_target = 'ap_isolate=$ISOLATE_CLIENTS\nEOF'
patch1_replacement = '''ap_isolate=$ISOLATE_CLIENTS
EOF

[[ -n "$MAX_NUM_STA" ]] && echo "max_num_sta=$MAX_NUM_STA" >> $CONFDIR/hostapd.conf
[[ -n "$DENY_MAC_FILE" ]] && echo "macaddr_acl=0" >> $CONFDIR/hostapd.conf
[[ -n "$DENY_MAC_FILE" ]] && echo "deny_mac_file=$DENY_MAC_FILE" >> $CONFDIR/hostapd.conf'''

if patch1_target in content:
    content = content.replace(patch1_target, patch1_replacement, 1)
    print("[+] Patch 1 applied: Client Limits & MAC Filter")
else:
    print("[!] Patch 1 target not found or already applied")

# Patch 2: Comment out the 'no IR' check to allow 5GHz AP
patch2_target = '        [[ "${CHANNEL_INFO}" == *no\\ IR* ]] && return 1'
patch2_replacement = '        # [[ "${CHANNEL_INFO}" == *no\\ IR* ]] && return 1  # Patched: allow 5GHz AP on IR-CONCURRENT channels'

if patch2_target in content:
    content = content.replace(patch2_target, patch2_replacement, 1)
    print("[+] Patch 2 applied: 5GHz IR-CONCURRENT AP support")
else:
    print("[!] Patch 2 target not found or already applied")

# Patch 2b: Enable 802.11h DFS Spectrum Management when country_code is set
patch2b_target = 'country_code=${COUNTRY}\nieee80211d=1'
patch2b_replacement = 'country_code=${COUNTRY}\nieee80211d=1\nieee80211h=1'

if patch2b_target in content:
    content = content.replace(patch2b_target, patch2b_replacement, 1)
    print("[+] Patch 2b applied: 802.11h DFS Spectrum Management enabled")
else:
    print("[!] Patch 2b target not found or already applied")

# Patch 3: Support pure WPA3-Personal (SAE only)
patch3_target = '''    if [[ "$WPA_VERSION" == "3" ]]; then
        # Configuring for WPA3 Transition Mode
        # 80211w must be 1 or Apple Devices will not connect. 
        # 1 is the only valid value for WPA3 Transition Mode
        cat << EOF >> $CONFDIR/hostapd.conf
wpa=2
wpa_${WPA_KEY_TYPE}=${PASSPHRASE}
wpa_key_mgmt=WPA-PSK SAE
wpa_pairwise=CCMP
rsn_pairwise=CCMP
ieee80211w=1
EOF'''

patch3_replacement = '''    if [[ "$WPA_VERSION" == "3" || "$WPA_VERSION" == "wpa3-mixed" ]]; then
        # Configuring for WPA3 Transition Mode (WPA2 + WPA3 Mixed)
        cat << EOF >> $CONFDIR/hostapd.conf
wpa=2
wpa_${WPA_KEY_TYPE}=${PASSPHRASE}
wpa_key_mgmt=WPA-PSK SAE
wpa_pairwise=CCMP
rsn_pairwise=CCMP
ieee80211w=1
EOF
    elif [[ "$WPA_VERSION" == "3-only" || "$WPA_VERSION" == "wpa3" || "$WPA_VERSION" == "sae" ]]; then
        # Configuring for Pure WPA3-Personal (SAE Only)
        cat << EOF >> $CONFDIR/hostapd.conf
wpa=2
wpa_${WPA_KEY_TYPE}=${PASSPHRASE}
wpa_key_mgmt=SAE
rsn_pairwise=CCMP
ieee80211w=2
EOF'''

if patch3_target in content:
    content = content.replace(patch3_target, patch3_replacement, 1)
    print("[+] Patch 3 applied: WPA3-Personal pure SAE mode support")
else:
    print("[!] Patch 3 target not found or already applied")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("[+] All patches successfully applied to", filepath)
