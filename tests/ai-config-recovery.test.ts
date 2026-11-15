import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAiConfig, type AiConfig, type AiConfigView } from '../src/core/ai';
import { AiConfigStore, type AiSecretStorage } from '../src/desktop/ai-config-store';
import { AiService } from '../src/desktop/ai-service';

const settings = (extra: Partial<AiConfig> = {}): AiConfig => ({ ...defaultAiConfig, baseUrl: 'https://config-test.invalid/v1', model: 'fixture-model', ...extra });
const encode = (config = settings(), encryptedKey?: string) => Buffer.from(JSON.stringify({ version: 1, config, encryptedKey }));
const storage = (available = true): AiSecretStorage => ({
  isEncryptionAvailable: () => available,
  // Only a deterministic fixture. Actual desktop storage uses Electron's vault.
  encryptString: value => Buffer.from(Array.from(Buffer.from(value), byte => byte ^ 0x5a)),
  decryptString: value => Buffer.from(Array.from(value, byte => byte ^ 0x5a)).toString('utf8'),
});
const fixtureReply = (url: string) => new Response(JSON.stringify(url.endsWith('/models')
  ? { data: [{ id: 'fixture-model' }] }
  : { choices: [{ message: { content: '连接成功。' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
async function temporary(t: TestContext) {
  const base = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(base, 'vns-ai-config-recovery-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('vns-ai-config-recovery-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, file: path.join(directory, 'ai-settings.json') };
}
const token = (view: AiConfigView) => {
  assert.ok(view.loadIssue);
  assert.equal(view.loadIssue?.kind, 'corrupt');
  assert.equal(view.loadIssue.canReset, true);
  assert.ok(view.loadIssue.recoveryId);
  return view.loadIssue.recoveryId;
};

test('invalid configuration is recoverable without decrypting, requesting, exposing or overwriting its contents', async t => {
  const { file, directory } = await temporary(t);
  let decrypts = 0, requests = 0;
  const ai = new AiService({ file,
    vault: { ...storage(), decryptString: () => { decrypts++; return 'old-fixture-key'; } },
    fetch: async () => { requests++; throw new Error('Invalid settings must never reach a provider.'); },
  });
  const encryptedKey = Buffer.from('old-sensitive-fixture').toString('base64');
  const invalid = [
    Buffer.from('{ damaged secret-fixture'), Buffer.from([0xff, 0xfe, 0x00, 0x7b]),
    Buffer.from('null'), Buffer.from('[]'), Buffer.from('{}'),
    Buffer.from(JSON.stringify({ encryptedKey })),
    Buffer.from(JSON.stringify({ version: 9, config: settings(), encryptedKey })),
    encode({ ...settings(), timeoutSeconds: 1 }, encryptedKey),
    encode({ ...settings(), baseUrl: 'file:///private-fixture' }, encryptedKey),
    encode({ ...settings(), baseUrl: 'https://name:password@bad.invalid/v1' }, encryptedKey),
  ];
  let previous = '';
  for (const source of invalid) {
    await fs.writeFile(file, source);
    const view = await ai.getConfig(), recoveryId = token(view);
    assert.notEqual(recoveryId, previous); previous = recoveryId;
    assert.equal(token(await ai.getConfig()), recoveryId);
    assert.deepEqual({ ...view, loadIssue: undefined }, { ...defaultAiConfig, hasKey: false, keyStorage: 'none', loadIssue: undefined });
    assert.doesNotMatch(JSON.stringify(view), /old-sensitive-fixture|old-fixture-key|password|private-fixture/);
    await assert.rejects(ai.test('broken_test'), /配置文件损坏/);
    await assert.rejects(ai.listModels('broken_models', { ...settings(), apiKey: 'new-fixture-key' }), /配置文件损坏/);
    await assert.rejects(ai.saveConfig(settings()), /配置文件损坏/);
    assert.deepEqual(await fs.readFile(file), source);
    assert.deepEqual(await fs.readdir(directory), ['ai-settings.json']);
  }
  assert.equal(decrypts, 0); assert.equal(requests, 0);
});

test('unreadable files disable reset and can be read again after access is restored', async t => {
  const { file } = await temporary(t), source = encode();
  await fs.writeFile(file, source);
  const read = fs.readFile;
  const mocked = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === file) throw Object.assign(new Error('private-path-fixture'), { code: 'EACCES' });
    return read(...args);
  });
  let requests = 0;
  const ai = new AiService({ file, vault: storage(), fetch: async url => { requests++; return fixtureReply(String(url)); } });
  const view = await ai.getConfig();
  assert.equal(view.loadIssue?.kind, 'unreadable'); assert.equal(view.loadIssue?.canReset, false);
  assert.equal(view.loadIssue?.recoveryId, undefined); assert.doesNotMatch(JSON.stringify(view), /private-path/);
  await assert.rejects(ai.saveConfig(settings()), /无法读取 AI 配置/);
  await assert.rejects(ai.test('unreadable'), /无法读取 AI 配置/);
  await assert.rejects(ai.resetConfig('00000000-0000-4000-8000-000000000000'), /重新读取设置/);
  assert.equal(requests, 0);
  mocked.mock.restore();
  assert.equal((await ai.getConfig()).loadIssue, undefined);
  assert.match(await ai.test('readable'), /连接成功/); assert.equal(requests, 1);
  assert.deepEqual(await fs.readFile(file), source);
});

test('a missing file is a normal empty setup and session keys survive repeated configuration reads', async t => {
  const { file } = await temporary(t), authorizations: (string | null)[] = [];
  const ai = new AiService({ file, vault: storage(false), fetch: async (url, init) => {
    authorizations.push(new Headers(init?.headers).get('Authorization')); return fixtureReply(String(url));
  } });
  assert.deepEqual(await ai.getConfig(), { ...defaultAiConfig, hasKey: false, keyStorage: 'none' });
  const saved = await ai.saveConfig({ ...settings(), apiKey: 'session-fixture-key' });
  assert.equal(saved.keyStorage, 'session'); assert.equal(saved.loadIssue, undefined);
  assert.deepEqual(await ai.getConfig(), saved); assert.deepEqual(await ai.getConfig(), saved);
  await ai.test('session'); assert.deepEqual(authorizations, ['Bearer session-fixture-key']);
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /session-fixture-key|encryptedKey/);
  assert.equal((await new AiService({ file, vault: storage() }).getConfig()).hasKey, false);
});

test('a transient read error blocks requests but keeps a session key for the unchanged healthy file', async t => {
  const { file } = await temporary(t), authorizations: (string | null)[] = [];
  const ai = new AiService({ file, vault: storage(false), fetch: async (url, init) => {
    authorizations.push(new Headers(init?.headers).get('Authorization')); return fixtureReply(String(url));
  } });
  const saved = await ai.saveConfig({ ...settings(), apiKey: 'retained-session-fixture' }), read = fs.readFile;
  const mocked = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === file) throw Object.assign(new Error('temporarily-unreadable'), { code: 'EACCES' });
    return read(...args);
  });
  const unavailable = await ai.getConfig(); assert.equal(unavailable.loadIssue?.kind, 'unreadable'); assert.equal(unavailable.hasKey, false);
  await assert.rejects(ai.test('unreadable_session'), /无法读取 AI 配置/); assert.equal(authorizations.length, 0);
  mocked.mock.restore();
  assert.deepEqual(await ai.getConfig(), saved);
  await ai.test('retained_session'); assert.deepEqual(authorizations, ['Bearer retained-session-fixture']);
});

test('reset preserves every original byte before installing an empty key-free configuration', async t => {
  const { file, directory } = await temporary(t);
  const source = Buffer.concat([Buffer.from([0xff, 0x00, 0xfe]), Buffer.from('\r\n damaged config with fixture private bytes\r\n')]);
  await fs.writeFile(file, source);
  const ai = new AiService({ file, vault: storage(false) });
  const recoveryId = token(await ai.getConfig());
  const result = await ai.resetConfig(recoveryId);
  assert.equal(path.basename(result.backupName), result.backupName);
  assert.match(result.backupName, /^ai-settings\.json\.before-reset-[\w-]+\.bak$/);
  assert.deepEqual(await fs.readFile(path.join(directory, result.backupName)), source);
  assert.deepEqual(result.config, { ...defaultAiConfig, hasKey: false, keyStorage: 'none' });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { version: 1, config: defaultAiConfig });
  assert.equal((await ai.getConfig()).loadIssue, undefined);
  await assert.rejects(ai.resetConfig(recoveryId), /重新读取设置/);
  assert.equal((await fs.readdir(directory)).length, 2);
  const configured = await ai.saveConfig({ ...settings(), apiKey: 'fresh-session-key' });
  assert.equal(configured.hasKey, true); assert.equal(configured.keyStorage, 'session');
});

test('a failed backup never rewrites the source and recovery can be retried', async t => {
  const { file, directory } = await temporary(t), source = Buffer.from('{ broken backup fixture');
  await fs.writeFile(file, source);
  const ai = new AiService({ file, vault: storage() });
  const recoveryId = token(await ai.getConfig()), open = fs.open;
  const mocked = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).endsWith('.bak')) throw Object.assign(new Error('private-backup-fixture'), { code: 'EACCES' });
    return open(...args);
  });
  await assert.rejects(ai.resetConfig(recoveryId), /未能备份旧 AI 配置，未重置设置/);
  assert.deepEqual(await fs.readFile(file), source); assert.equal(token(await ai.getConfig()), recoveryId);
  assert.deepEqual(await fs.readdir(directory), ['ai-settings.json']);
  mocked.mock.restore();
  assert.equal((await ai.resetConfig(recoveryId)).config.loadIssue, undefined);
});

test('a failed atomic replacement leaves the bad source and a complete recovery copy', async t => {
  const { file, directory } = await temporary(t), source = Buffer.from('{ broken rename fixture');
  await fs.writeFile(file, source);
  const ai = new AiService({ file, vault: storage() });
  const recoveryId = token(await ai.getConfig()), rename = fs.rename;
  const mocked = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] === file) throw Object.assign(new Error('private-rename-fixture'), { code: 'EIO' });
    return rename(...args);
  });
  await assert.rejects(ai.resetConfig(recoveryId), /旧配置已备份，但重置未完成/);
  assert.deepEqual(await fs.readFile(file), source); assert.equal(token(await ai.getConfig()), recoveryId);
  const backups = (await fs.readdir(directory)).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1); assert.deepEqual(await fs.readFile(path.join(directory, backups[0])), source);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
  mocked.mock.restore();
  assert.equal((await ai.resetConfig(recoveryId)).config.loadIssue, undefined);
});

test('reset refuses an outdated recovery identity after a different bad file or an external repair', async t => {
  const { file, directory } = await temporary(t);
  await fs.writeFile(file, '{ old bad file');
  const ai = new AiService({ file, vault: storage() });
  const first = token(await ai.getConfig()), secondSource = Buffer.from('{ different bad file');
  await fs.writeFile(file, secondSource);
  await assert.rejects(ai.resetConfig(first), /重新读取设置/);
  assert.deepEqual(await fs.readFile(file), secondSource);
  const second = token(await ai.getConfig()); assert.notEqual(second, first);
  const repaired = encode(settings({ baseUrl: 'https://repaired.invalid/v1' }));
  await fs.writeFile(file, repaired);
  await assert.rejects(ai.resetConfig(second), /重新读取设置/);
  assert.deepEqual(await fs.readFile(file), repaired);
  const view = await ai.getConfig(); assert.equal(view.baseUrl, 'https://repaired.invalid/v1'); assert.equal(view.loadIssue, undefined);
  assert.deepEqual(await fs.readdir(directory), ['ai-settings.json']);
});

test('a configuration repaired while its recovery copy is being written is not reset', async t => {
  const { file, directory } = await temporary(t), source = Buffer.from('{ initial bad file');
  await fs.writeFile(file, source);
  const ai = new AiService({ file, vault: storage() });
  const recoveryId = token(await ai.getConfig()), repaired = encode(settings({ model: 'externally-repaired' })), open = fs.open;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith('.bak')) {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, 'sync', async () => { await sync(); await fs.writeFile(file, repaired); });
    }
    return handle;
  });
  await assert.rejects(ai.resetConfig(recoveryId), /重新读取设置/);
  assert.deepEqual(await fs.readFile(file), repaired); assert.equal((await ai.getConfig()).model, 'externally-repaired');
  const backups = (await fs.readdir(directory)).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1); assert.deepEqual(await fs.readFile(path.join(directory, backups[0])), source);
});

test('unavailable or invalid encrypted keys retain their service settings and require explicit repair', async t => {
  const { file } = await temporary(t), goodVault = storage();
  const encryptedKey = goodVault.encryptString('old-fixture-key').toString('base64');
  const cases = [
    { vault: storage(false), encryptedKey },
    { vault: { ...storage(), decryptString: () => { throw new Error('secret-decryption-details'); } }, encryptedKey },
    { vault: storage(), encryptedKey: 'invalid base64!' },
    { vault: { ...storage(), decryptString: () => 'line\nbreak' }, encryptedKey },
    { vault: { ...storage(), decryptString: () => '' }, encryptedKey },
  ];
  let requests = 0;
  for (const fixture of cases) {
    const source = encode(settings(), fixture.encryptedKey); await fs.writeFile(file, source);
    const ai = new AiService({ file, vault: fixture.vault, fetch: async url => { requests++; return fixtureReply(String(url)); } });
    const view = await ai.getConfig();
    assert.equal(view.baseUrl, settings().baseUrl); assert.equal(view.model, 'fixture-model'); assert.equal(view.hasKey, false);
    assert.equal(view.loadIssue?.kind, 'keyUnavailable'); assert.equal(view.loadIssue?.canReset, false); assert.equal(view.loadIssue?.recoveryId, undefined);
    assert.doesNotMatch(JSON.stringify(view), /old-fixture-key|secret-decryption-details/);
    await assert.rejects(ai.test('bad_key'), /重新填写密钥/);
    await assert.rejects(ai.listModels('bad_key_models', { ...settings(), apiKey: 'unsaved-new-key' }), /重新填写密钥/);
    await assert.rejects(ai.saveConfig(settings()), /重新填写密钥/);
    await assert.rejects(ai.saveConfig(settings({ baseUrl: 'https://new-origin.invalid/v1' })), /重新填写密钥/);
    assert.deepEqual(await fs.readFile(file), source);
    const fixed = await ai.saveConfig({ ...settings({ rememberKey: false }), apiKey: 'new-fixture-key' });
    assert.equal(fixed.loadIssue, undefined); assert.equal(fixed.hasKey, true); assert.equal(fixed.keyStorage, 'session');
    assert.deepEqual(await ai.getConfig(), fixed);
  }
  assert.equal(requests, 0);
});

test('an explicit key removal repairs unavailable encryption without silently sending an anonymous request first', async t => {
  const { file } = await temporary(t), vault = storage();
  await fs.writeFile(file, encode(settings(), vault.encryptString('old-fixture-key').toString('base64')));
  const authorizations: (string | null)[] = [];
  const ai = new AiService({ file, vault: storage(false), fetch: async (url, init) => {
    authorizations.push(new Headers(init?.headers).get('Authorization')); return fixtureReply(String(url));
  } });
  await assert.rejects(ai.test('before_clear'), /重新填写密钥/);
  const cleared = await ai.saveConfig({ ...settings(), clearKey: true });
  assert.equal(cleared.loadIssue, undefined); assert.equal(cleared.hasKey, false);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).encryptedKey, undefined);
  await ai.test('after_clear'); assert.deepEqual(authorizations, [null]);
});

test('re-reading after the vault becomes available recovers the saved key without a reset', async t => {
  const { file } = await temporary(t), vault = storage();
  await fs.writeFile(file, encode(settings(), vault.encryptString('fixture-restored-key').toString('base64')));
  let available = false;
  const ai = new AiService({ file, vault: { ...vault, isEncryptionAvailable: () => available } });
  assert.equal((await ai.getConfig()).loadIssue?.kind, 'keyUnavailable');
  available = true;
  const restored = await ai.getConfig(); assert.equal(restored.loadIssue, undefined); assert.equal(restored.hasKey, true); assert.equal(restored.keyStorage, 'encrypted');
});

test('externally replaced configuration never inherits the previous session key for a new service', async t => {
  const { file } = await temporary(t), authorizations: (string | null)[] = [];
  const ai = new AiService({ file, vault: storage(false), fetch: async (url, init) => {
    assert.ok(String(url).startsWith('https://replacement.invalid/'));
    authorizations.push(new Headers(init?.headers).get('Authorization')); return fixtureReply(String(url));
  } });
  await ai.saveConfig({ ...settings(), apiKey: 'old-session-fixture-key' });
  await fs.writeFile(file, encode(settings({ baseUrl: 'https://replacement.invalid/v1' })));
  assert.equal((await ai.getConfig()).hasKey, false);
  await ai.test('replacement'); assert.deepEqual(authorizations, [null]);
});

test('store reads, resets and saves are ordered so an older snapshot cannot overwrite a newer save', { timeout: 5000 }, async t => {
  const { file, directory } = await temporary(t), source = Buffer.from('{ queued bad file');
  await fs.writeFile(file, source);
  const store = new AiConfigStore({ file, vault: storage(false) }), recoveryId = token(await store.get());
  const reset = store.reset(recoveryId), saved = store.save({ ...settings(), apiKey: 'queued-session-key' }), viewed = store.get();
  const result = await reset; assert.deepEqual(await fs.readFile(path.join(directory, result.backupName)), source);
  assert.deepEqual(await viewed, await saved);
  const read = fs.readFile, started = deferred(), release = deferred();
  let first = true;
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    const value = await read(...args);
    if (args[0] === file && first) { first = false; started.resolve(); await release.promise; }
    return value;
  });
  const before = store.get(); await started.promise;
  const afterSave = store.save({ ...settings({ model: 'newer-model' }), apiKey: 'newer-session-key' });
  const after = store.get(); release.resolve();
  assert.equal((await before).model, 'fixture-model');
  assert.deepEqual(await after, await afterSave); assert.equal((await after).model, 'newer-model');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).config.model, 'newer-model');
});

test('failed ordinary saves preserve both the file and its existing session key', async t => {
  const { file } = await temporary(t), authorizations: (string | null)[] = [];
  const ai = new AiService({ file, vault: storage(false), fetch: async (url, init) => {
    authorizations.push(new Headers(init?.headers).get('Authorization')); return fixtureReply(String(url));
  } });
  const original = await ai.saveConfig({ ...settings(), apiKey: 'kept-session-fixture' }), source = await fs.readFile(file), rename = fs.rename;
  const mocked = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] === file) throw Object.assign(new Error('write-failed-fixture'), { code: 'EIO' });
    return rename(...args);
  });
  await assert.rejects(ai.saveConfig({ ...settings({ model: 'failed-model' }), apiKey: 'rejected-new-fixture' }), /保存 AI 配置失败/);
  assert.deepEqual(await fs.readFile(file), source); assert.deepEqual(await ai.getConfig(), original);
  mocked.mock.restore();
  await ai.test('kept_key'); assert.deepEqual(authorizations, ['Bearer kept-session-fixture']);
});

test('stopping during settings loading prevents a provider call and does not poison a reused request id', { timeout: 5000 }, async t => {
  const { file } = await temporary(t); await fs.writeFile(file, encode());
  const read = fs.readFile;
  for (const operation of ['test', 'models', 'cancelAll'] as const) {
    const started = deferred(), release = deferred(); let first = true, requests = 0;
    const mocked = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
      const value = await read(...args);
      if (args[0] === file && first) { first = false; started.resolve(); await release.promise; }
      return value;
    });
    const ai = new AiService({ file, vault: storage(), fetch: async url => { requests++; return fixtureReply(String(url)); } });
    const execute = () => operation === 'models' ? ai.listModels('reused_request', settings()) : ai.test('reused_request');
    ai.cancel('reused_request'); // Cancelling an absent request must not affect a later one.
    const pending = execute(); await started.promise;
    await assert.rejects(ai.saveConfig(settings()), /请先停止请求再修改设置/);
    if (operation === 'cancelAll') ai.cancelAll(); else ai.cancel('reused_request');
    const stopped = assert.rejects(pending, /已停止/); release.resolve(); await stopped;
    assert.equal(requests, 0);
    await execute(); assert.equal(requests, 1);
    mocked.mock.restore();
  }
});

test('configuration mutation and active requests are mutually exclusive through their async preparation', { timeout: 5000 }, async t => {
  const { file } = await temporary(t), entered = deferred(), release = deferred(), rename = fs.rename;
  const mocked = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] === file) { entered.resolve(); await release.promise; }
    return rename(...args);
  });
  let requests = 0;
  const ai = new AiService({ file, vault: storage(false), fetch: async url => { requests++; return fixtureReply(String(url)); } });
  const saving = ai.saveConfig(settings()); await entered.promise;
  await assert.rejects(ai.test('while_saving'), /AI 设置正在保存或恢复/);
  await assert.rejects(ai.listModels('models_while_saving', settings()), /AI 设置正在保存或恢复/);
  release.resolve(); await saving; mocked.mock.restore(); assert.equal(requests, 0);
  ai.beginUsage('between_agent_steps');
  await assert.rejects(ai.saveConfig(settings()), /请先停止请求再修改设置/);
  await assert.rejects(ai.resetConfig('00000000-0000-4000-8000-000000000000'), /请先停止请求再修改设置/);
  ai.takeUsage('between_agent_steps');
  await ai.saveConfig(settings()); await ai.test('after_saving'); assert.equal(requests, 1);
});
