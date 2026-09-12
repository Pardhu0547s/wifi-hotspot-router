#!/usr/bin/env python3
"""Patch /usr/bin/create_ap for wifi-hotspot-router extension.

Applies two patches:
1. Client Limits & MAC Filter: Adds MAX_NUM_STA and DENY_MAC_FILE support
   to hostapd.conf generation.
2. 5GHz IR-CONCURRENT AP: Comments out the 'no IR' check that blocks 5GHz AP
   on Intel WiFi cards with self-managed regulatory domains.
"""

filepath = '/usr/bin/create_ap'

with open(filepath, 'r') as f:
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
    print("[!] Patch 1 target not found (may already be applied)")

# Patch 2: Comment out the 'no IR' check to allow 5GHz AP
patch2_target = '        [[ "${CHANNEL_INFO}" == *no\\ IR* ]] && return 1'
patch2_replacement = '        # [[ "${CHANNEL_INFO}" == *no\\ IR* ]] && return 1  # Patched: allow 5GHz AP on IR-CONCURRENT channels'

if patch2_target in content:
    content = content.replace(patch2_target, patch2_replacement, 1)
    print("[+] Patch 2 applied: 5GHz IR-CONCURRENT AP support")
else:
    print("[!] Patch 2 target not found (may already be applied)")

with open(filepath, 'w') as f:
    f.write(content)

print("[+] All patches written to", filepath)
