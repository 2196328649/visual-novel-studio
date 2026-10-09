/** Windows treats environment names case-insensitively; Node's spawn keeps only
 * one of PATH/Path. Merge by that rule so private tools actually take priority. */
export function nativeEnvironment(overrides: NodeJS.ProcessEnv = {}, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const source of [base, overrides]) for (const [name, value] of Object.entries(source)) {
    const key = process.platform === 'win32' ? name.toUpperCase() : name;
    if (value === undefined) delete result[key]; else result[key] = value;
  }
  for (const name of Object.keys(result)) if (['pythonhome', 'pythonpath', 'renpy_base', 'electron_run_as_node'].includes(name.toLowerCase())) delete result[name];
  return result;
}
