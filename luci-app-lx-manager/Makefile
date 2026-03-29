# Copyright (C) 2026
#
# This is free software, licensed under the ISC License.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-lx-manager
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=ISC
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for LX Manager
  DEPENDS:=+node +curl
endef

define Package/$(PKG_NAME)/description
  LX Manager provides a local fallback proxy service for LX Music and offers
  an OpenWrt/iStoreOS LuCI management page.
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/lx-manager
endef

define Build/Configure
endef

define Build/Compile
endef

APP_SRC_DIR:=$(CURDIR)/..

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/lx-manager $(1)/etc/config/lx-manager

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/lx-manager $(1)/etc/init.d/lx-manager

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./luasrc/controller/lx_manager.lua $(1)/usr/lib/lua/luci/controller/lx_manager.lua

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi
	$(INSTALL_DATA) ./luasrc/model/cbi/lx_manager.lua $(1)/usr/lib/lua/luci/model/cbi/lx_manager.lua

	$(INSTALL_DIR) $(1)/usr/libexec/lx-manager
	$(INSTALL_DATA) $(APP_SRC_DIR)/app.js $(1)/usr/libexec/lx-manager/app.js
	$(INSTALL_DATA) $(APP_SRC_DIR)/updater.js $(1)/usr/libexec/lx-manager/updater.js
	$(INSTALL_DATA) $(APP_SRC_DIR)/package.json $(1)/usr/libexec/lx-manager/package.json
	$(CP) $(APP_SRC_DIR)/lib $(1)/usr/libexec/lx-manager/
	$(CP) $(APP_SRC_DIR)/sources $(1)/usr/libexec/lx-manager/
	$(CP) $(APP_SRC_DIR)/node_modules $(1)/usr/libexec/lx-manager/
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache 2>/dev/null
}
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
