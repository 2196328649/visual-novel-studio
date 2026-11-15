import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { aiConfigSchema, aiEndpoint, defaultAiConfig, type AiConfig, type AiConfigLoadIssue, type AiConfigResetResult, type AiConfigUpdate, type AiConfigView } from '../core/ai';
import { atomicWrite, WriteQueue } from './project-store';

export interface AiSecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface ConfigState {
  config: AiConfig;
  key: string;
  keyStorage: AiConfigView['keyStorage'];
  source?: Buffer;
  loadIssue?: AiConfigLoadIssue;
}

const storedConfigSchema = z.object({
  version: z.literal(1).optional(),
  config: aiConfigSchema,
  encryptedKey: z.string().max(65536).optional(),
}).strict();
const unavailableKeyMessage = '无法读取已保存的 API 密钥。请重新填写密钥并保存，或明确移除旧密钥。';
const changedConfigMessage = 'AI 配置已变化，请重新读取设置后再尝试恢复。';
const emptyState = (): ConfigState => ({ config: { ...defaultAiConfig }, key: '', keyStorage: 'none' });
const validKey = (value: unknown): value is string => typeof value === 'string' && value.length <= 16384 && !/[\r\n]/.test(value);

/** All disk reads and mutations share one queue. Failed reads are retryable;
 * a session key is retained only while the on-disk bytes still match. */
export class AiConfigStore {
  private state: ConfigState = emptyState();
  private readableState?: ConfigState;
  private queue = new WriteQueue();

  constructor(private options: { file: string; vault: AiSecretStorage }) {}

  private view(): AiConfigView {
    return {
      ...this.state.config, hasKey: !!this.state.key, keyStorage: this.state.keyStorage,
      ...(this.state.loadIssue ? { loadIssue: { ...this.state.loadIssue } } : {}),
    };
  }

  private accept(state: ConfigState) {
    this.state = state;
    this.readableState = state.loadIssue ? undefined : state;
  }

  private async read() {
    let source: Buffer;
    try { source = await fs.readFile(this.options.file); }
    catch (error) {
      this.state = emptyState();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.readableState = undefined;
      else {
        this.state.loadIssue = { kind: 'unreadable', message: '无法读取 AI 配置。请检查文件访问权限后重新读取。', canReset: false };
      }
      return;
    }

    let stored: z.infer<typeof storedConfigSchema>;
    try {
      stored = storedConfigSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)));
      aiEndpoint(stored.config.baseUrl);
    } catch {
      const recoveryId = this.state.loadIssue?.kind === 'corrupt' && this.state.source?.equals(source)
        ? this.state.loadIssue.recoveryId! : randomUUID();
      this.accept({ ...emptyState(), source, loadIssue: { kind: 'corrupt', message: 'AI 配置文件损坏或格式无法识别。可以重新读取，或先备份旧配置再重置。', canReset: true, recoveryId } });
      return;
    }

    // A transient read failure must not erase an in-session key. It can only
    // be restored after successfully reading the exact same healthy bytes.
    if (this.readableState?.source?.equals(source)) { this.state = this.readableState; return; }
    const next: ConfigState = { config: stored.config, key: '', keyStorage: 'none', source };
    if (stored.encryptedKey) {
      try {
        if (!this.options.vault.isEncryptionAvailable()) throw new Error('unavailable');
        const encrypted = Buffer.from(stored.encryptedKey, 'base64');
        if (!encrypted.length || encrypted.toString('base64') !== stored.encryptedKey) throw new Error('invalid');
        const key = this.options.vault.decryptString(encrypted);
        if (!validKey(key) || !key.trim()) throw new Error('invalid');
        next.key = key.trim(); next.keyStorage = 'encrypted';
      } catch {
        next.loadIssue = { kind: 'keyUnavailable', message: unavailableKeyMessage, canReset: false };
      }
    }
    this.accept(next);
  }

  get(): Promise<AiConfigView> {
    return this.queue.run(async () => { await this.read(); return this.view(); });
  }

  private settings(update: AiConfigUpdate) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('请检查 API 地址、模型和超时设置。');
    const { apiKey, clearKey, ...raw } = update;
    const parsed = aiConfigSchema.safeParse(raw);
    if (!parsed.success) throw new Error('请检查 API 地址、模型和超时设置。');
    aiEndpoint(parsed.data.baseUrl);
    if ((apiKey !== undefined && !validKey(apiKey)) || (clearKey !== undefined && typeof clearKey !== 'boolean')) throw new Error('API 密钥格式无效。');
    if (this.state.loadIssue?.kind === 'keyUnavailable' && !clearKey && !apiKey?.trim()) throw new Error(unavailableKeyMessage);
    const changedOrigin = new URL(aiEndpoint(this.state.config.baseUrl)).origin !== new URL(aiEndpoint(parsed.data.baseUrl)).origin;
    return { config: parsed.data, key: clearKey ? '' : apiKey?.trim() || (changedOrigin ? '' : this.state.key) };
  }

  resolve(update?: AiConfigUpdate): Promise<{ config: AiConfig; key: string }> {
    return this.queue.run(async () => {
      await this.read();
      if (this.state.loadIssue) throw new Error(this.state.loadIssue.message);
      return update ? this.settings(update) : { config: { ...this.state.config }, key: this.state.key };
    });
  }

  save(update: AiConfigUpdate): Promise<AiConfigView> {
    return this.queue.run(async () => {
      await this.read();
      if (this.state.loadIssue && this.state.loadIssue.kind !== 'keyUnavailable') throw new Error(this.state.loadIssue.message);
      const { config, key } = this.settings(update);
      let encryptedKey: string | undefined;
      try {
        if (key && config.rememberKey && this.options.vault.isEncryptionAvailable()) {
          const encrypted = this.options.vault.encryptString(key);
          if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error('invalid');
          encryptedKey = encrypted.toString('base64');
        }
      } catch { throw new Error('无法安全保存 API 密钥，请稍后重试，或取消在本机保存密钥。'); }
      const contents = JSON.stringify({ version: 1, config, encryptedKey }, null, 2);
      try { await atomicWrite(this.options.file, contents); }
      catch { throw new Error('保存 AI 配置失败，请检查文件写入权限后重新读取设置。'); }
      this.accept({ config, key, keyStorage: key ? encryptedKey ? 'encrypted' : 'session' : 'none', source: Buffer.from(contents) });
      return this.view();
    });
  }

  reset(recoveryId: string): Promise<AiConfigResetResult> {
    return this.queue.run(async () => {
      if (typeof recoveryId !== 'string' || !/^[a-f0-9-]{36}$/i.test(recoveryId)) throw new Error(changedConfigMessage);
      await this.read();
      const source = this.state.source;
      if (!source || this.state.loadIssue?.kind !== 'corrupt' || this.state.loadIssue.recoveryId !== recoveryId) throw new Error(changedConfigMessage);

      const backupName = `${path.basename(this.options.file)}.before-reset-${randomUUID()}.bak`;
      const backup = path.join(path.dirname(this.options.file), backupName);
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      let created = false;
      try {
        handle = await fs.open(backup, 'wx', 0o600); created = true;
        await handle.writeFile(source); await handle.sync(); await handle.close(); handle = undefined;
      } catch {
        await handle?.close().catch(() => undefined);
        if (created) await fs.rm(backup, { force: true }).catch(() => undefined);
        throw new Error('未能备份旧 AI 配置，未重置设置。请检查文件写入权限后重试。');
      }

      // Recheck after the potentially slow backup so an externally repaired
      // file, or a replacement from another window, is not reset from an old UI.
      await this.read();
      if (this.state.loadIssue?.kind !== 'corrupt' || this.state.loadIssue.recoveryId !== recoveryId || !this.state.source?.equals(source)) throw new Error(changedConfigMessage);
      const config = { ...defaultAiConfig };
      const contents = JSON.stringify({ version: 1, config }, null, 2);
      try { await atomicWrite(this.options.file, contents); }
      catch { throw new Error('旧配置已备份，但重置未完成。请检查文件写入权限后重新读取设置。'); }
      this.accept({ config, key: '', keyStorage: 'none', source: Buffer.from(contents) });
      return { config: this.view(), backupName };
    });
  }
}
