import type { RunResult } from '../core/bridge';

export async function revealExportResult(result: RunResult, openDirectory: (directory: string) => Promise<string>): Promise<RunResult> {
  if (!result.ok || result.cancelled || !result.outputPath) return result;
  try {
    const error = await openDirectory(result.outputPath);
    if (error) throw new Error(error);
    return result;
  } catch (error) {
    const message = `游戏已导出，未能自动打开文件夹：${error instanceof Error ? error.message : String(error)}。可在作品设置中点击“打开位置”。`;
    return { ...result, diagnostics: [...result.diagnostics, { severity: 'warning', message }], log: result.log + '\n' + message };
  }
}
