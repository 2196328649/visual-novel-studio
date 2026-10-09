import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
const release = path.join(root, 'release');
const sourceRootName = `Visual-Novel-Studio-${version}`;
const sourceName = `${sourceRootName}-source.zip`;
const sampleName = `Rainy-Day-${version}-win.zip`;
const installerName = `Visual Novel Studio Setup ${version}.exe`;
const included = [
  'src',
  'scripts',
  'tests',
  'docs',
  'README.md',
  '.gitignore',
  'index.html',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'resources/example',
  'resources/SAMPLE-CREDITS.md',
  'resources/THIRD-PARTY-NOTICES.txt',
  'resources/licenses',
  'resources/spine',
  'resources/templates',
  'resources/export-tools.json',
  'resources/tools',
  'native',
  'vendor',
] as const;

interface SourceFile { path: string; bytes: number; sha256: string }

async function sha256(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function sourceFiles(relative: string): Promise<string[]> {
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Source archives do not follow links: ${relative}`);
  if (stat.isDirectory()) {
    const files: string[] = [];
    for (const child of (await fs.readdir(absolute)).sort()) {
      files.push(...await sourceFiles(`${relative}/${child}`));
    }
    return files;
  }
  if (!stat.isFile()) throw new Error(`Unsupported source entry: ${relative}`);
  if (/\.docx?$/i.test(relative) || (/\.vns\.json(?:\.autosave)?$/i.test(relative) && !['resources/example/project.vns.json', 'resources/templates/aihong/project.vns.json'].includes(relative))) {
    throw new Error(`Private document or project data is outside the source archive scope: ${relative}`);
  }
  return [relative];
}

async function dotnetZip(stage: string, archive: string, manifest: string): Promise<void> {
  // Paths and the source manifest travel through environment variables, never shell interpolation.
  const command = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest = Get-Content -LiteralPath $env:VNS_RELEASE_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json
$file = [System.IO.File]::Open($env:VNS_RELEASE_ARCHIVE, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($file, [System.IO.Compression.ZipArchiveMode]::Create, $true, [System.Text.Encoding]::UTF8)
  try {
    foreach ($item in $manifest.files) {
      $entryName = $env:VNS_RELEASE_ARCHIVE_ROOT + '/' + $item.path
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
      $source = [System.IO.File]::OpenRead([System.IO.Path]::Combine($env:VNS_RELEASE_STAGE, $item.path))
      try {
        $destination = $entry.Open()
        try { $source.CopyTo($destination) } finally { $destination.Dispose() }
      } finally { $source.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $file.Dispose() }
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:VNS_RELEASE_ARCHIVE)
try {
  if ($archive.Entries.Count -ne $manifest.files.Count) { throw 'Source archive entry count does not match the manifest.' }
  foreach ($item in $manifest.files) {
    $entry = $archive.GetEntry($env:VNS_RELEASE_ARCHIVE_ROOT + '/' + $item.path)
    if ($null -eq $entry -or $entry.Length -ne $item.bytes) { throw ('Archive entry is missing or has the wrong size: ' + $item.path) }
    $stream = $entry.Open()
    $digest = [System.Security.Cryptography.SHA256]::Create()
    try {
      $actual = [System.BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
      if ($actual -ne $item.sha256) { throw ('Archive entry checksum mismatch: ' + $item.path) }
    } finally { $digest.Dispose(); $stream.Dispose() }
  }
} finally { $archive.Dispose() }
`;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        VNS_RELEASE_STAGE: stage,
        VNS_RELEASE_ARCHIVE: archive,
        VNS_RELEASE_MANIFEST: manifest,
        VNS_RELEASE_ARCHIVE_ROOT: sourceRootName,
      },
    });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Source ZIP creation or verification failed (${code}).`)));
  });
}

async function prepareReleaseArtifacts(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Release archive preparation requires Windows PowerShell and .NET.');
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
  if (metadata.version !== version) throw new Error(`Expected package version ${version}, received ${metadata.version}.`);
  const installer = path.join(release, installerName);
  const sampleSource = path.join(root, 'artifacts', 'runtime-distributions', `project_rainy_day-${version}-win.zip`);
  for (const required of [installer, sampleSource]) {
    const stat = await fs.lstat(required);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Release input is not a nonempty regular file: ${required}`);
  }
  const files = (await Promise.all(included.map(sourceFiles))).flat().sort();
  if (files.length !== new Set(files).size) throw new Error('The source allowlist contains overlapping paths.');
  const run = path.join(root, 'artifacts', 'release-staging', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
  const stage = path.join(run, sourceRootName);
  await fs.mkdir(stage, { recursive: true });
  const sourceManifest: SourceFile[] = [];
  for (const relative of files) {
    const original = path.join(root, relative);
    const destination = path.join(stage, relative);
    const before = await sha256(original);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(original, destination);
    const copied = await sha256(destination);
    if (before !== copied || copied !== await sha256(original)) throw new Error(`Source changed while staging: ${relative}`);
    sourceManifest.push({ path: relative, bytes: (await fs.stat(destination)).size, sha256: copied });
  }
  const manifest = path.join(run, 'source-manifest.json');
  await fs.writeFile(manifest, JSON.stringify({ version, included, files: sourceManifest }, null, 2) + '\n', 'utf8');
  const sourceArchive = path.join(run, sourceName);
  await dotnetZip(stage, sourceArchive, manifest);
  const installerHash = await sha256(installer);
  const originalSampleHash = await sha256(sampleSource);
  const sample = path.join(release, sampleName);
  await fs.copyFile(sampleSource, sample);
  if (await sha256(sample) !== originalSampleHash || await sha256(sampleSource) !== originalSampleHash) throw new Error('The delivered sample ZIP differs from the validated runtime distribution.');
  const deliveredSource = path.join(release, sourceName);
  await fs.copyFile(sourceArchive, deliveredSource);
  const sourceHash = await sha256(sourceArchive);
  if (await sha256(deliveredSource) !== sourceHash) throw new Error('The delivered source ZIP differs from the verified archive.');
  if (await sha256(installer) !== installerHash) throw new Error('The installer changed while preparing the release artifacts.');
  const hashes = [
    { filename: installerName, sha256: installerHash },
    { filename: sampleName, sha256: originalSampleHash },
    { filename: sourceName, sha256: sourceHash },
  ];
  await fs.writeFile(path.join(release, 'SHA256SUMS.txt'), hashes.map((item) => `${item.sha256}  ${item.filename}`).join('\n') + '\n', 'utf8');
  const report = { version, staging: run, manifest, sourceFiles: files.length, sourceBytes: sourceManifest.reduce((total, file) => total + file.bytes, 0), artifacts: hashes };
  await fs.writeFile(path.join(run, 'release-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

await prepareReleaseArtifacts();
