import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pythonLiteral } from '../../src/runtime/literals';
import { preserveRenpyScreenshots } from './text-typography';
import { cleanVerificationDirectories } from './verification-cleanup';

/** Each native suite owns a fresh child even when all suites share an artifact root. */
export function flowRuntimeOutput(suite: string) {
  return path.join(path.resolve(process.env.VNS_ARTIFACT_ROOT ?? `artifacts/${suite}-runtime`), `${suite}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
}

/** Records only values supplied by the native testcase, directly outside its temporary game. */
export function flowRuntimeTraceSource(output: string) {
  return `
init python:
    import json as qa_trace_json
    import os as qa_trace_os
    def qa_trace(name, **values):
        directory = ${pythonLiteral(path.join(output, 'traces').replaceAll('\\', '/'))}
        qa_trace_os.makedirs(directory, exist_ok=True)
        with open(qa_trace_os.path.join(directory, name + ".json"), "w", encoding="utf-8") as file:
            qa_trace_json.dump(dict(name=name, values=values), file, ensure_ascii=False, indent=2)
`;
}

/** Keep the actual engine counts separate from authored expectations, including failed runs. */
export function recordFlowNativeResult(report: Record<string, unknown>, tests: string, result: { code: number; log: string }, expectedCases: number) {
  report.code = result.code;
  report.expectedCases = expectedCases;
  report.expectedAssertions = tests.split('\n').filter(line => line.trim().startsWith('assert ')).length;
  const cases = result.log.match(/Test cases\s*:\s*(\d+)\s*\|\s*(\d+) passed/);
  const assertions = result.log.match(/Assertions\s*:\s*(\d+)\s*\|\s*(\d+) passed/);
  report.cases = cases ? Number(cases[1]) : null;
  report.passedCases = cases ? Number(cases[2]) : null;
  report.runtimeAssertions = assertions ? Number(assertions[1]) : null;
  report.passedAssertions = assertions ? Number(assertions[2]) : null;
  assert.equal(result.code, 0, result.log.slice(-8000));
  assert.equal(report.cases, expectedCases, 'all native cases must execute');
  assert.equal(report.passedCases, expectedCases, 'all native cases must pass');
  assert.equal(report.runtimeAssertions, report.expectedAssertions, 'all authored native assertions must execute');
  assert.equal(report.passedAssertions, report.expectedAssertions, 'all authored native assertions must pass');
}

/** Preserve screenshots and native crash/test traces before removing only this run's fixtures. */
export async function finishFlowNativeVerification(output: string, game: string, report: Record<string, unknown>, previousSaves: string | undefined, options: { cleanup?: boolean } = {}) {
  let failure: unknown;
  let preserved = false;
  try {
    await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
    const visit = async (directory: string, relative = ''): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      })) {
        const child = path.join(directory, entry.name), next = path.join(relative, entry.name);
        if (entry.isDirectory() && !['assets', 'fonts', 'gui', 'saves', 'cache'].includes(entry.name)) await visit(child, next);
        else if (entry.isFile() && /_tracesave|traceback|^errors\.txt$|^log\.txt$|^(?:test-)?report\.html$/i.test(entry.name)) {
          const destination = path.join(output, 'native-diagnostics', next);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(child, destination);
        }
      }
    };
    await visit(game);
    const list = async (directory: string, extension: string): Promise<string[]> => {
      const found: string[] = [];
      for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      })) {
        if (entry.isDirectory()) found.push(...(await list(path.join(directory, entry.name), extension)).map(name => path.join(entry.name, name)));
        else if (entry.isFile() && entry.name.endsWith(extension)) found.push(entry.name);
      }
      return found;
    };
    report.screenshots = await list(path.join(output, 'screenshots'), '.png');
    report.traces = await list(path.join(output, 'traces'), '.json');
    preserved = true;
  } catch (error) { report.status = 'failed'; report.evidenceError = String(error); failure = error; }
  finally {
    if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES;
    else process.env.RENPY_PATH_TO_SAVES = previousSaves;
    if (preserved || options.cleanup === false) {
      try {
        if (options.cleanup === false) {
          report.cleanup = { retained: true, evidencePreserved: preserved, reason: 'Temporary directories are listed for the final coordinated cleanup.',
            targets: await Promise.all(['source', 'game', 'saves', 'renpy-saves'].map(async name => {
              const target = path.resolve(output, name);
              const exists = await fs.stat(target).then(() => true).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
                throw error;
              });
              return { path: target, exists };
            })) };
        } else {
          report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
          assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
        }
      } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
    } else report.cleanup = { retained: true, reason: 'Native evidence could not be preserved.' };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(path.join(output, 'report.json'));
  }
  return failure;
}
