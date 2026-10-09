import { spawn } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release'), input = path.join(release, 'win-unpacked');
const folder = `Visual-Novel-Studio-${version}`, filename = `${folder}-portable-win-x64.zip`;
const stage = path.join(root, 'artifacts/portable-package', `${version}-${randomUUID().slice(0, 8)}`);
const sha256 = async file => {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
};
const files = [];
async function collect(directory, prefix = '') {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`便携包中不能包含链接：${entry.name}`);
    const relative = prefix + entry.name, source = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(source, relative + '/');
    else if (entry.isFile()) files.push({ path: relative, source, bytes: (await fs.stat(source)).size, sha256: await sha256(source) });
  }
}
await fs.access(path.join(input, 'Visual Novel Studio.exe'));
await fs.access(path.join(input, 'resources/app.asar'));
if (await fs.access(path.join(input, 'portable.json')).then(() => true, () => false)) throw new Error('安装版目录不应包含便携标记。');
await fs.mkdir(stage, { recursive: true });
await collect(input);
await fs.writeFile(path.join(stage, 'portable.json'), JSON.stringify({ format: 1, version, dataDirectory: 'data' }, null, 2) + '\n');
await fs.copyFile(path.join(root, 'docs/portable.md'), path.join(stage, '使用说明.md'));
for (const name of ['portable.json', '使用说明.md']) {
  const source = path.join(stage, name);
  files.push({ path: name, source, bytes: (await fs.stat(source)).size, sha256: await sha256(source) });
}
const manifest = path.join(stage, 'manifest.json'), archive = path.join(stage, filename);
await fs.writeFile(manifest, JSON.stringify({ version, folder, files }, null, 2));
const command = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest = Get-Content -LiteralPath $env:VNS_PORTABLE_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json
$file = [System.IO.File]::Open($env:VNS_PORTABLE_ARCHIVE, [System.IO.FileMode]::CreateNew)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($file, [System.IO.Compression.ZipArchiveMode]::Create, $true, [System.Text.Encoding]::UTF8)
  try {
    foreach ($item in $manifest.files) {
      $entry = $archive.CreateEntry($manifest.folder + '/' + $item.path, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
      $source = [System.IO.File]::OpenRead($item.source)
      try { $stream = $entry.Open(); try { $source.CopyTo($stream) } finally { $stream.Dispose() } } finally { $source.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $file.Dispose() }
$zip = [System.IO.Compression.ZipFile]::OpenRead($env:VNS_PORTABLE_ARCHIVE)
try {
  if ($zip.Entries.Count -ne $manifest.files.Count) { throw '便携包文件数量不一致。' }
  foreach ($item in $manifest.files) {
    $entry = $zip.GetEntry($manifest.folder + '/' + $item.path)
    if ($null -eq $entry -or $entry.Length -ne $item.bytes) { throw ('便携包文件缺失：' + $item.path) }
    $stream = $entry.Open(); $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
      $actual = [System.BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
      if ($actual -ne $item.sha256) { throw ('便携包校验失败：' + $item.path) }
    } finally { $hash.Dispose(); $stream.Dispose() }
  }
} finally { $zip.Dispose() }
`;
await new Promise((resolve, reject) => {
  const child = spawn(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, stdio: 'inherit', env: { ...process.env, VNS_PORTABLE_MANIFEST: manifest, VNS_PORTABLE_ARCHIVE: archive },
  });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`便携包构建失败：${code}`)));
});
const destination = path.join(release, filename);
await fs.copyFile(archive, destination);
const result = { version, file: destination, bytes: (await fs.stat(destination)).size, sha256: await sha256(destination), manifest, files: files.length };
await fs.writeFile(path.join(release, `portable-${version}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
