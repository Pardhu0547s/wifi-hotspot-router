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

echo -e "\n=== Phase 2: Deploying GNOME Extension ==="
mkdir -p "$HOME/.local/share/gnome-shell/extensions"

# Handle existing deployments/symlinks cleanly
if [ -L "$TARGET_DIR" ] || [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
fi

ln -s "$SOURCE_DIR" "$TARGET_DIR"
echo "[+] Symlink successfully pointing to development workspace directory."

echo -e "\n=== Phase 3: Activation Guidelines ==="
echo "Please restart GNOME Shell (log out and back in) to apply the changes."
echo "Then enable the extension:"
echo "    gnome-extensions enable $UUID"
echo "=========================================================="
