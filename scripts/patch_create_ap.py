#!/usr/bin/env python3

import sys
import os
import shutil
import re

def main():
    filepath = sys.argv[1] if len(sys.argv) > 1 else (
        shutil.which('create_ap') or 
        ('/usr/local/bin/create_ap' if os.path.isfile('/usr/local/bin/create_ap') else '/usr/bin/create_ap')
    )

    if not os.path.isfile(filepath):
        print(f"Error: create_ap binary not found at '{filepath}'", file=sys.stderr)
        sys.exit(1)

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    original_content = content

    patch1_target = 'ap_isolate=$ISOLATE_CLIENTS\nEOF'
    patch1_replacement = '''ap_isolate=$ISOLATE_CLIENTS
EOF

[[ -n "$MAX_NUM_STA" ]] && echo "max_num_sta=$MAX_NUM_STA" >> $CONFDIR/hostapd.conf
[[ -n "$DENY_MAC_FILE" ]] && echo "macaddr_acl=0" >> $CONFDIR/hostapd.conf
[[ -n "$DENY_MAC_FILE" ]] && echo "deny_mac_file=$DENY_MAC_FILE" >> $CONFDIR/hostapd.conf'''

    if patch1_target in content:
        content = content.replace(patch1_target, patch1_replacement, 1)
        print("[+] Patch 1 applied: Client Limits & MAC Filter")
    elif 'max_num_sta=$MAX_NUM_STA' in content:
        print("[*] Patch 1 already present: Client Limits & MAC Filter")

    patch2_pattern = re.compile(r'^\s*\[\[\s*"\${CHANNEL_INFO}"\s*==\s*\*no\\?\s+IR\*\s*\]\]\s*&&\s*return\s+1', re.MULTILINE)
    if patch2_pattern.search(content):
        content = patch2_pattern.sub(r'        # [[ "${CHANNEL_INFO}" == *no\\ IR* ]] && return 1  # Patched: allow 5GHz AP on IR-CONCURRENT channels', content, count=1)
        print("[+] Patch 2 applied: 5GHz IR-CONCURRENT AP support")
    elif 'Patched: allow 5GHz AP on IR-CONCURRENT channels' in content:
        print("[*] Patch 2 already present: 5GHz IR-CONCURRENT AP support")

    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"[+] Successfully wrote patches to {filepath}")
    else:
        print(f"[*] {filepath} is already patched.")

if __name__ == '__main__':
    main()
