// 后端公开域名：直连新服务器的 API 子域名（82.156.243.32，Let's Encrypt 证书、HTTPS 反代到 backend:8081）。
// 2026-10-11 主域名迁移到 zlfshop.cn（备案完成）；api.zlfshop.xyz 保留可用但不再作为默认入口。
// 这是唯一能供 App 可靠走通 HTTPS 的入口——
// （旧服务器 zlfshop.xyz 的 443 在云层只放行浏览器指纹，curl/RN 会被重置；切勿用它。）
// 前提：腾讯云安全组已对全网开放该服务器 443。
export const API_BASE = 'https://api.zlfshop.cn'