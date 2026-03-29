local sys = require "luci.sys"
local http = require "luci.http"
local uci = require "luci.model.uci".cursor()

local port = uci:get("lx-manager", "main", "port") or "4000"
local router_ip = sys.exec("uci -q get network.lan.ipaddr 2>/dev/null | tr -d '\n'")

if router_ip == "" then
	router_ip = http.getenv("SERVER_ADDR") or "router.lan"
end

local subscribe_url = string.format("http://%s:%s/custom-source.js", router_ip, port)

m = Map("lx-manager", translate("LX Manager"),
	translate("为 LX Music 提供本地综合回退源代理，并优先使用本地 sources 中最近日期目录的音源。"))

m.description = translatef(
	"当前订阅地址示例：%s 。如果你把端口改掉了，保存后请按新端口重新复制订阅地址。",
	subscribe_url
)
m.apply_on_parse = true

s = m:section(NamedSection, "main", "main", translate("Basic Settings"))
s.anonymous = true

local service_status = s:option(DummyValue, "_service_status", translate("Service Status"))
service_status.rawhtml = true
service_status.cfgvalue = function()
	local running = sys.call("/etc/init.d/lx-manager status >/dev/null 2>&1") == 0
	if running then
		return "<span style=\"color:#2e7d32;font-weight:600\">RUNNING</span>"
	end
	return "<span style=\"color:#c62828;font-weight:600\">STOPPED</span>"
end

local enabled = s:option(Flag, "enabled", translate("Enable"))
enabled.rmempty = false

local host = s:option(Value, "host", translate("Listen Host"))
host.default = "0.0.0.0"
host.rmempty = false

local port_opt = s:option(Value, "port", translate("Listen Port"))
port_opt.datatype = "port"
port_opt.default = "4000"
port_opt.rmempty = false

local source_base_dir = s:option(Value, "source_base_dir", translate("Sources Directory"))
source_base_dir.default = "/etc/lx-manager/sources"
source_base_dir.description = translate("建议改到外部存储，例如 /mnt/sda1/lx-manager/sources。")
source_base_dir.rmempty = false

local log_dir = s:option(Value, "log_dir", translate("Log Directory"))
log_dir.default = "/var/log/lx-manager"
log_dir.description = translate("如果希望日志持久化，建议改到外部存储。")
log_dir.rmempty = false

local proxy_url = s:option(Value, "proxy_url", translate("Outbound Proxy URL"))
proxy_url.placeholder = "http://127.0.0.1:7890"
proxy_url.description = translate("只有路由器本机可访问代理时才需要填写。")

local github_token = s:option(Value, "github_token", translate("GitHub Token"))
github_token.password = true
github_token.description = translate("用于手动更新 sources 时降低 GitHub API 限流概率。")

local max_days = s:option(Value, "max_days", translate("Keep Source Snapshots (Days)"))
max_days.datatype = "uinteger"
max_days.default = "30"

local search_limit = s:option(Value, "search_limit", translate("GitHub Search Repo Limit"))
search_limit.datatype = "uinteger"
search_limit.default = "10"

local max_commit_age_months = s:option(Value, "max_commit_age_months", translate("Max Commit Age (Months)"))
max_commit_age_months.datatype = "uinteger"
max_commit_age_months.default = "3"

local window_ms = s:option(Value, "url_select_window_ms", translate("Playback Selection Window (ms)"))
window_ms.datatype = "uinteger"
window_ms.default = "4000"
window_ms.description = translate("只在限定时间内返回的音源里选最优结果，避免全部等待。")

local max_concurrent = s:option(Value, "url_max_concurrent_requests", translate("Max Concurrent Source Requests"))
max_concurrent.datatype = "uinteger"
max_concurrent.default = "3"

local max_candidates = s:option(Value, "url_max_candidates", translate("Max Candidate Sources"))
max_candidates.datatype = "uinteger"
max_candidates.default = "6"

local log_retention = s:option(Value, "log_retention_days", translate("Log Retention (Days)"))
log_retention.datatype = "uinteger"
log_retention.default = "7"

local log_total = s:option(Value, "log_max_total_size_bytes", translate("Max Total Log Size (Bytes)"))
log_total.datatype = "uinteger"
log_total.default = "52428800"

local log_file = s:option(Value, "log_max_file_size_bytes", translate("Max Single Log File Size (Bytes)"))
log_file.datatype = "uinteger"
log_file.default = "10485760"

local log_cleanup = s:option(Value, "log_cleanup_interval_ms", translate("Log Cleanup Interval (ms)"))
log_cleanup.datatype = "uinteger"
log_cleanup.default = "21600000"

local start_btn = s:option(Button, "_start", translate("Start Service"))
start_btn.inputstyle = "apply"
function start_btn.write()
	sys.call("/etc/init.d/lx-manager start >/dev/null 2>&1")
end

local stop_btn = s:option(Button, "_stop", translate("Stop Service"))
stop_btn.inputstyle = "reset"
function stop_btn.write()
	sys.call("/etc/init.d/lx-manager stop >/dev/null 2>&1")
end

local restart_btn = s:option(Button, "_restart", translate("Restart Service"))
restart_btn.inputstyle = "apply"
function restart_btn.write()
	sys.call("/etc/init.d/lx-manager restart >/dev/null 2>&1")
end

local update_btn = s:option(Button, "_update", translate("Run Source Update"))
update_btn.inputstyle = "apply"
update_btn.description = translate("后台执行一次音源更新，输出会写入日志目录，同时保留到 /tmp/lx-manager-update.log。")
function update_btn.write()
	sys.call("/etc/init.d/lx-manager update >/tmp/lx-manager-update.log 2>&1 &")
end

return m
