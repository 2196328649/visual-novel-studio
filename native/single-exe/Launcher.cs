using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Threading;
using System.Runtime.InteropServices;

class Manifest { public long bytes; public string sha256; public string entry; public string title; }
class SliceStream : Stream {
    readonly Stream source; readonly long start, length; long position;
    public SliceStream(Stream source, long start, long length) { this.source = source; this.start = start; this.length = length; }
    public override bool CanRead { get { return true; } } public override bool CanSeek { get { return true; } } public override bool CanWrite { get { return false; } }
    public override long Length { get { return length; } }
    public override long Position { get { return position; } set { Seek(value, SeekOrigin.Begin); } }
    public override int Read(byte[] buffer, int offset, int count) { source.Position = start + position; int n = source.Read(buffer, offset, (int)Math.Min(count, length - position)); position += n; return n; }
    public override long Seek(long offset, SeekOrigin origin) { long n = (origin == SeekOrigin.Begin ? 0 : origin == SeekOrigin.Current ? position : length) + offset; if (n < 0 || n > length) throw new IOException("Invalid package position"); position = n; return n; }
    public override void Flush() { } public override void SetLength(long value) { throw new NotSupportedException(); } public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
}
static class Launcher {
    const string Magic = "VNS-ONE-EXE-0001";
    static string SafePath(string root, string relative) {
        if (String.IsNullOrEmpty(relative) || Path.IsPathRooted(relative) || relative.Contains(":")) throw new IOException("包内路径无效。");
        string file = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("包内路径超出游戏目录。");
        return file;
    }
    static string Quote(string s) { return "\"" + System.Text.RegularExpressions.Regex.Replace(s, "(\\\\*)\"", "$1$1\\\"").TrimEnd('\\') + new string('\\', s.Reverse().TakeWhile(c => c == '\\').Count() * 2) + "\""; }
    static int Run(string[] args, Action<string, int> progress, CancellationToken cancel) {
        string directory = null;
        try {
            string self = Application.ExecutablePath;
            using (var source = File.Open(self, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                if (source.Length < Magic.Length + 4) throw new IOException("游戏包不完整。");
                source.Position = source.Length - Magic.Length - 4;
                var reader = new BinaryReader(source, Encoding.UTF8, true);
                int manifestBytes = reader.ReadInt32();
                if (Encoding.ASCII.GetString(reader.ReadBytes(Magic.Length)) != Magic || manifestBytes <= 0 || manifestBytes > 65536) throw new IOException("游戏包尾部校验失败，请重新导出或下载。");
                long manifestAt = source.Length - Magic.Length - 4 - manifestBytes;
                if (manifestAt < 0) throw new IOException("游戏包已截断。");
                source.Position = manifestAt;
                var manifest = new JavaScriptSerializer().Deserialize<Manifest>(Encoding.UTF8.GetString(reader.ReadBytes(manifestBytes)));
                if (manifest.bytes <= 0 || manifest.bytes > manifestAt) throw new IOException("游戏数据长度无效。");
                progress("正在校验游戏文件…", 5);
                using (var payload = new SliceStream(source, manifestAt - manifest.bytes, manifest.bytes)) {
                    using (var hash = SHA256.Create()) {
                        byte[] buffer = new byte[1048576]; int read;
                        while ((read = payload.Read(buffer, 0, buffer.Length)) > 0) { cancel.ThrowIfCancellationRequested(); hash.TransformBlock(buffer, 0, read, buffer, 0); }
                        hash.TransformFinalBlock(buffer, 0, 0);
                        string actual = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
                        if (actual != manifest.sha256) throw new IOException("游戏数据损坏，请重新导出或下载。");
                    }
                    cancel.ThrowIfCancellationRequested(); payload.Position = 0;
                    // Each launch owns exactly one fresh directory. Saves remain in Ren'Py's AppData location.
                    directory = Path.Combine(Path.GetTempPath(), "vns-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(directory);
                    using (var zip = new ZipArchive(payload, ZipArchiveMode.Read, true, Encoding.UTF8)) {
                        long total = zip.Entries.Sum(e => e.Length), written = 0;
                        if (new DriveInfo(Path.GetPathRoot(directory)).AvailableFreeSpace < total + 16777216) throw new IOException("临时目录所在磁盘空间不足，请释放空间后重试。");
                        foreach (var entry in zip.Entries) {
                            cancel.ThrowIfCancellationRequested();
                            if ((entry.ExternalAttributes >> 16 & 0xF000) == 0xA000) throw new IOException("游戏包不能包含符号链接。");
                            string file = SafePath(directory, entry.FullName);
                            if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(file); continue; }
                            Directory.CreateDirectory(Path.GetDirectoryName(file));
                            using (var input = entry.Open()) using (var output = new FileStream(file, FileMode.CreateNew)) {
                                byte[] buffer = new byte[1048576]; int read;
                                while ((read = input.Read(buffer, 0, buffer.Length)) > 0) { cancel.ThrowIfCancellationRequested(); output.Write(buffer, 0, read); }
                            }
                            written += entry.Length; progress("正在准备游戏，请稍候…", 10 + (int)(80.0 * written / Math.Max(1, total)));
                        }
                    }
                }
                string executable = SafePath(directory, manifest.entry);
                if (!File.Exists(executable) || !executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) throw new IOException("未找到游戏启动文件。");
                cancel.ThrowIfCancellationRequested(); progress("正在启动游戏…", 100);
                var start = new ProcessStartInfo(executable, String.Join(" ", args.Select(Quote))) { WorkingDirectory = Path.GetDirectoryName(executable), UseShellExecute = false };
                using (var game = Process.Start(start)) { game.WaitForExit(); return game.ExitCode; }
            }
        } finally {
            if (directory != null) {
                // Only remove the verified directory created by this invocation, after its game exits.
                string temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (directory.StartsWith(temp + "vns-", StringComparison.OrdinalIgnoreCase)) for (int i = 0; i < 5; i++) {
                    try { Directory.Delete(directory, true); break; } catch (IOException) { Thread.Sleep(200); } catch (UnauthorizedAccessException) { break; }
                }
            }
        }
    }
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();
        var form = new Form { Text = "启动游戏", Width = 430, Height = 155, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
        var label = new Label { Text = "正在读取游戏包…", Left = 20, Top = 20, Width = 370 };
        var bar = new ProgressBar { Left = 20, Top = 55, Width = 370, Height = 22 };
        form.Controls.Add(label); form.Controls.Add(bar);
        var cancellation = new CancellationTokenSource(); bool finished = false; int exit = 0;
        form.FormClosing += (sender, e) => { if (!finished) { cancellation.Cancel(); e.Cancel = true; label.Text = "正在取消…"; } };
        form.Shown += async (sender, e) => {
            try { exit = await Task.Run(() => Run(args, (message, percent) => {
                if (!form.IsDisposed) form.BeginInvoke((Action)(() => { label.Text = message; bar.Value = Math.Min(100, percent); if (percent == 100) form.Hide(); }));
            }, cancellation.Token)); }
            catch (OperationCanceledException) { exit = 0; }
            catch (Exception error) { exit = 1; MessageBox.Show(error.Message, "游戏启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { finished = true; form.Close(); }
        };
        Application.Run(form); cancellation.Dispose(); return exit;
    }
}
