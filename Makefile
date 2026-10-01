# Makefile for Wi-Fi Hotspot Router GNOME Shell Extension

UUID = wifi-hotspot-router@pardhu0547s.github.com
PREFIX ?= /usr/local
SYSTEMD_DIR ?= /etc/systemd/system
POLKIT_RULES_DIR ?= /etc/polkit-1/rules.d
POLKIT_ACTIONS_DIR ?= /usr/share/polkit-1/actions
NM_CONF_DIR ?= /etc/NetworkManager/conf.d

TARGET_USER ?= $(if $(SUDO_USER),$(SUDO_USER),$(shell whoami))
TARGET_HOME ?= $(shell getent passwd $(TARGET_USER) | cut -d: -f6)
LOCAL_EXT_DIR = $(TARGET_HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all build install install-system install-user uninstall uninstall-system uninstall-user clean pack check

all: build

build:
	@echo "Compiling GSettings schemas..."
	glib-compile-schemas schemas/

check:
	@echo "Checking bash scripts syntax..."
	@bash -n bin/start_hotspot
	@bash -n bin/start_hotspot_post
	@bash -n bin/stop_hotspot
	@bash -n bin/manage_hotspot_clients
	@bash -n setup.sh
	@echo "Checking Python script syntax..."
	@python3 -m py_compile scripts/patch_create_ap.py
	@echo "Checking metadata.json..."
	@python3 -c "import json; json.load(open('metadata.json'))"
	@echo "Checking GSettings schemas..."
	@glib-compile-schemas --strict schemas/
	@echo "Checking Polkit XML policy..."
	@python3 -c "import xml.etree.ElementTree as ET; ET.parse('polkit/org.gnome.shell.extensions.wifi-hotspot.policy')"
	@echo "All files passed syntax and schema validation."

install-system:
	@echo "Installing system engine and services..."
	install -d -m 755 $(PREFIX)/bin
	install -m 755 bin/start_hotspot $(PREFIX)/bin/start_hotspot
	install -m 755 bin/start_hotspot_post $(PREFIX)/bin/start_hotspot_post
	install -m 755 bin/stop_hotspot $(PREFIX)/bin/stop_hotspot
	install -m 755 bin/manage_hotspot_clients $(PREFIX)/bin/manage_hotspot_clients
	install -d -m 755 $(SYSTEMD_DIR)
	install -m 644 systemd/wifi-hotspot@.service $(SYSTEMD_DIR)/wifi-hotspot@.service
	systemctl daemon-reload
	install -d -m 755 $(POLKIT_RULES_DIR)
	install -m 644 polkit/99-wifi-hotspot.rules $(POLKIT_RULES_DIR)/99-wifi-hotspot.rules
	install -d -m 755 $(POLKIT_ACTIONS_DIR)
	install -m 644 polkit/org.gnome.shell.extensions.wifi-hotspot.policy $(POLKIT_ACTIONS_DIR)/org.gnome.shell.extensions.wifi-hotspot.policy
	install -d -m 755 $(NM_CONF_DIR)
	printf "[keyfile]\nunmanaged-devices=interface-name:*_ap;interface-name:ap0;interface-name:ap1;interface-name:vmnet*\n" > $(NM_CONF_DIR)/99-wifi-hotspot-unmanage.conf
	systemctl reload NetworkManager || true

install-user: build
	@echo "Installing GNOME extension to $(LOCAL_EXT_DIR)..."
	mkdir -p $(LOCAL_EXT_DIR)
	cp -r metadata.json extension.js prefs.js stylesheet.css schemas $(LOCAL_EXT_DIR)/
	@if [ -n "$(SUDO_USER)" ]; then \
		chown -R $(TARGET_USER):$(TARGET_USER) $(LOCAL_EXT_DIR); \
	fi

install: install-system install-user

uninstall-system:
	@echo "Removing system files..."
	rm -f $(PREFIX)/bin/start_hotspot
	rm -f $(PREFIX)/bin/start_hotspot_post
	rm -f $(PREFIX)/bin/stop_hotspot
	rm -f $(PREFIX)/bin/manage_hotspot_clients
	rm -f $(SYSTEMD_DIR)/wifi-hotspot@.service
	systemctl daemon-reload
	rm -f $(POLKIT_RULES_DIR)/99-wifi-hotspot.rules
	rm -f $(POLKIT_ACTIONS_DIR)/org.gnome.shell.extensions.wifi-hotspot.policy
	rm -f $(NM_CONF_DIR)/99-wifi-hotspot-unmanage.conf
	systemctl reload NetworkManager || true

uninstall-user:
	@echo "Removing GNOME extension from $(LOCAL_EXT_DIR)..."
	rm -rf $(LOCAL_EXT_DIR)

uninstall: uninstall-user uninstall-system

pack:
	@echo "Packaging extension..."
	gnome-extensions pack --force \
		--schema=schemas/org.gnome.shell.extensions.wifi-hotspot-router.gschema.xml \
		--extra-source=prefs.js \
		--extra-source=stylesheet.css \
		.
	@echo "Package created: $(UUID).shell-extension.zip"

clean:
	rm -f schemas/gschemas.compiled
	rm -f *.zip *.shell-extension.zip
	rm -rf scripts/__pycache__ bin/__pycache__
