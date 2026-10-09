import test from 'node:test';
import assert from 'node:assert/strict';
import { javaProxyOptions } from '../src/desktop/java-proxy';

test('Java tools honor the first system route and preserve local connections', () => {
  assert.deepEqual(javaProxyOptions('DIRECT; PROXY proxy.example:8080'), []);
  const options = javaProxyOptions('PROXY 127.0.0.1:7894; DIRECT');
  assert.ok(options.includes('-Dhttps.proxyHost=127.0.0.1'));
  assert.ok(options.includes('-Dhttp.proxyPort=7894'));
  assert.ok(options.includes('-Dhttp.nonProxyHosts=localhost|127.*|[::1]'));
  assert.deepEqual(javaProxyOptions('SOCKS5 [::1]:1080'), ['-DsocksProxyHost=[::1]', '-DsocksProxyPort=1080', '-DsocksProxyVersion=5']);
});

test('proxy data cannot inject JVM arguments or credentials into process output', () => {
  for (const value of ['PROXY host:12345 -Dother=value', 'PROXY user:secret@host:8080', 'PROXY host:0', 'PROXY host:65536', 'HTTPS host:8443', 'PROXY host:80\n-Dother=value']) assert.deepEqual(javaProxyOptions(value), []);
});
