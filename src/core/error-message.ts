/** Electron's IPC wrapper and custom error names add no useful recovery information. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  .replace(/^AiRetryableError:\s*/, '');
