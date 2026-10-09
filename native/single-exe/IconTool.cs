using System;
using System.IO;
using System.Runtime.InteropServices;
class IconTool {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr handle, bool discard);
    static int Main(string[] args) {
        try {
            byte[] icon = File.ReadAllBytes(args[1]); var reader = new BinaryReader(new MemoryStream(icon));
            if (reader.ReadUInt16() != 0 || reader.ReadUInt16() != 1) throw new Exception("Invalid ICO");
            ushort count = reader.ReadUInt16(); if (count == 0 || count > 256) throw new Exception("Invalid ICO count");
            IntPtr handle = BeginUpdateResource(args[0], false); if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            bool success = false;
            try {
                var group = new MemoryStream(); var writer = new BinaryWriter(group); writer.Write((ushort)0); writer.Write((ushort)1); writer.Write(count);
                for (ushort i = 0; i < count; i++) {
                    reader.BaseStream.Position = 6 + i * 16; byte[] header = reader.ReadBytes(12); uint size = BitConverter.ToUInt32(header, 8), offset = reader.ReadUInt32();
                    if (offset + (long)size > icon.Length) throw new Exception("Truncated ICO");
                    byte[] pixels = new byte[size]; Array.Copy(icon, offset, pixels, 0, size);
                    if (!UpdateResource(handle, new IntPtr(3), new IntPtr(i + 1), 0, pixels, size)) throw new System.ComponentModel.Win32Exception();
                    writer.Write(header); writer.Write((ushort)(i + 1));
                }
                byte[] bytes = group.ToArray(); if (!UpdateResource(handle, new IntPtr(14), new IntPtr(1), 0, bytes, (uint)bytes.Length)) throw new System.ComponentModel.Win32Exception();
                success = true;
            } finally { if (!EndUpdateResource(handle, !success)) throw new System.ComponentModel.Win32Exception(); }
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
    }
}
