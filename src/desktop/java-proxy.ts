/** Translate Chromium's selected proxy to JVM options without a shell. */
export function javaProxyOptions(rule: string): string[] {
  const first = rule.split(';')[0]?.trim() ?? '';
  if (!first || first === 'DIRECT') return [];
  const match = /^(PROXY|SOCKS5?|SOCKS4) (\[[a-fA-F0-9:]+\]|[a-zA-Z0-9._-]+):(\d{1,5})$/.exec(first);
  if (!match || +match[3] < 1 || +match[3] > 65535) return [];
  const [, kind, host, port] = match;
  if (kind === 'PROXY') return [`-Dhttp.proxyHost=${host}`, `-Dhttp.proxyPort=${port}`, `-Dhttps.proxyHost=${host}`, `-Dhttps.proxyPort=${port}`, '-Dhttp.nonProxyHosts=localhost|127.*|[::1]'];
  return [`-DsocksProxyHost=${host}`, `-DsocksProxyPort=${port}`, `-DsocksProxyVersion=${kind === 'SOCKS4' ? 4 : 5}`];
}
