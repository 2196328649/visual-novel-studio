import { promises as fs } from 'node:fs';
import { aiConfigSchema, aiEndpoint, type AiConfigUpdate } from '../../src/core/ai';

/** The previously supplied three-line test configuration stays within the isolated session. */
export async function liveAiProvider(file = process.env.VNS_LIVE_AI_TOKEN_FILE): Promise<AiConfigUpdate | undefined> {
  if (!file) return;
  const lines = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (lines.length !== 3) throw new Error('测试配置需要三行：服务地址、密钥、模型名称。');
  const baseUrl = lines[0].replace(/^(?:base[_ -]?url|url|api[_ -]?(?:url|base)|模型地址|地址)\s*[:=：]\s*/i, '');
  const apiKey = lines[1].replace(/^(?:api[_ -]?key|key|密钥)\s*[:=：]\s*/i, '');
  const model = lines[2].replace(/^(?:model(?:[_ -]?name)?|模型名称|模型)\s*[:=：]\s*/i, '');
  const parsed = aiConfigSchema.safeParse({ baseUrl, model, jsonMode: true, timeoutSeconds: 180, rememberKey: false });
  if (!parsed.success || !model || !apiKey || apiKey.length > 16384) throw new Error('测试配置格式无效。');
  aiEndpoint(baseUrl);
  return { ...parsed.data, apiKey };
}
