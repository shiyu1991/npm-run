/** 纯逻辑：监听地址 + 端口 → 可在浏览器打开的 URL。不依赖 vscode，可单测。 */

/** 本机 / 通配地址（含 lsof 的 * 通配）：浏览器里统一用 localhost（0.0.0.0 / [::] 无法直接访问） */
const LOCAL_ADDRESSES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '::',
  '[::]',
  '*',
]);

/** IPv6 地址在 URL 里必须带方括号 */
function formatHost(address: string): string {
  return address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
}

/**
 * 监听地址列表 + 端口 → 浏览器 URL。
 * 双栈 / 多网卡监听时优先本机回环，其次取第一个地址（具体网卡 IP 原样保留）。
 * 端口 443 用 https，其余 http——协议无法从端口可靠推断，仅作此一处约定。
 */
export function toBrowseUrl(addresses: readonly string[], port: number): string {
  const usable = addresses.map((a) => a.trim()).filter(Boolean);
  const host = usable.some((a) => LOCAL_ADDRESSES.has(a.toLowerCase()))
    ? 'localhost'
    : formatHost(usable[0] ?? 'localhost');
  return `${port === 443 ? 'https' : 'http'}://${host}:${port}`;
}
