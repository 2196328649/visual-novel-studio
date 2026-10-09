import hashlib
import json
import pathlib
import struct
import subprocess
import zipfile

root = pathlib.Path(json.loads(pathlib.Path('E:/VNSAndroid-Vd9UcK/last-export.json').read_text('utf-8'))['distribution'])
apk, = root.glob('*.apk')
expected = json.loads(pathlib.Path('resources/spine/android/build.json').read_text('utf-8'))['files']
libraries = []
with zipfile.ZipFile(apk) as archive:
    for abi, digest in expected.items():
        data = archive.read('lib/' + abi + '/libvns_spine.so')
        actual = hashlib.sha256(data).hexdigest()
        assert actual == digest, abi
        assert data[:4] == b'\x7fELF'
        is64 = data[4] == 2
        offset = struct.unpack_from('<Q' if is64 else '<I', data, 32 if is64 else 28)[0]
        entry_size, count = struct.unpack_from('<HH', data, 54 if is64 else 42)
        aligns = []
        for index in range(count):
            at = offset + index * entry_size
            if struct.unpack_from('<I', data, at)[0] == 1:
                aligns.append(struct.unpack_from('<Q' if is64 else '<I', data, at + (48 if is64 else 28))[0])
        assert aligns and all(a >= 16384 for a in aligns), abi
        libraries.append(dict(abi=abi, sha256=actual, loadAlignments=aligns))
signature = (root / 'signature.txt').read_text('utf-8-sig')
assert 'Verified using v1 scheme (JAR signing): true' in signature
assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in signature
assert '8d927f58dbeeafe136e88334f8e98d8cadc6dfeefb2909c1ccea16c6df121be9' in signature
badging = subprocess.check_output(['E:/VNSAndroid-Vd9UcK/profile/export-tools/android-sdk/build-tools/36.0.0/aapt.exe', 'dump', 'badging', str(apk)], encoding='utf-8')
(root / 'badging.txt').write_text(badging, encoding='utf-8')
assert "sdkVersion:'21'" in badging
assert "targetSdkVersion:'36'" in badging
report = dict(status='passed', apk=str(apk), apkSha256=hashlib.sha256(apk.read_bytes()).hexdigest(), libraries=libraries, signature='signature.txt', badging='badging.txt', minSdk=21, targetSdk=36)
(root / 'apk-native-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
