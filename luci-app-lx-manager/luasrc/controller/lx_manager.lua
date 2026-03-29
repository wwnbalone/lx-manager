module("luci.controller.lx_manager", package.seeall)

local fs = require "nixio.fs"

function index()
	if not fs.access("/etc/config/lx-manager") then
		return
	end

	local page = entry({"admin", "services", "lx-manager"}, cbi("lx_manager"), _("LX Manager"), 60)
	page.dependent = true
end
