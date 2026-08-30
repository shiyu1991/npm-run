// 临时 workaround：本机 getaddrinfo 查 AAAA 记录悬挂（~11s），导致 vsce (typed-rest-client)
// 的 socketTimeout 被 DNS 解析拖爆而报 "Request timeout"。强制所有 https 请求用 IPv4 lookup。
console.error('[preload] active: force ipv4 lookup');
require('net').setDefaultAutoSelectFamily(false);
const dns = require('dns');
const origLookup = dns.lookup.bind(dns);
const v4Lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (typeof options === 'number') options = { family: options };
  origLookup(hostname, { ...options, family: 4 }, callback);
};
const https = require('https');
const origRequest = https.request;
https.request = function (...args) {
  const o = args[0];
  if (typeof o === 'object' && o !== null) {
    if (o.autoSelectFamily === undefined) o.autoSelectFamily = false;
    if (!o.lookup) o.lookup = v4Lookup;
  }
  return origRequest.apply(this, args);
};
