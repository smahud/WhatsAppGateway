# JIBAS WhatsApp Gateway (JIBAS WG)

JIBAS WG mengirim pesan dari menu **SMS JIBAS** melalui WhatsApp. Instalasi normal selalu memasang integrasi JIBAS dan mengaktifkan MOVE: `jbssms.outbox` → worker → `jibas_wg.outbox` → WhatsApp. Cakupan: satu akun WhatsApp dan pesan teks keluar. Pesan masuk, webhook inbox, dan fitur SMS interaktif tidak digantikan.

## Sebelum memasang

- Siapkan **JIBAS yang sudah berjalan**. `jbssms.outbox` harus InnoDB; database gateway dan `jbssms` harus berada di instance MySQL/MariaDB yang sama. Gunakan [akun database aplikasi](#akun-database-jibas).
- Cadangkan DB/config/sesi dan hentikan consumer SMS lama sebelum mengaktifkan MOVE. Jika ada pesan lama yang belum tercatat oleh trigger, installer normal berhenti tanpa memindahkannya. Gunakan `--no-activate-move` untuk staging.
- Untuk instalasi pertama: **clone atau unduh dan ekstrak ZIP → salin dan edit `config.json` → jalankan installer**. Node.js/dependensi disiapkan installer; tidak perlu menjalankan `npm ci` secara manual.

## Windows

Gunakan PowerShell **Administrator** dari folder khusus proyek di luar profil pengguna, misalnya `C:\JIBAS_WG`. Installer membatasi izin folder proyek untuk Administrator, SYSTEM, dan `LocalService`.

```powershell
# Pilihan jika memakai Git; lewati jika sudah mengekstrak ZIP.
git clone https://github.com/smahud/WhatsAppGateway.git C:\JIBAS_WG
Set-Location C:\JIBAS_WG
if (!(Test-Path .\config.json)) { Copy-Item .\config.example.json .\config.json }
notepad.exe .\config.json
```

Isi `host`, `db_port`, `user`, dan `password` sesuai **database JIBAS**. Untuk instalasi baru gunakan `db_type: "mysql"` dan `database: "jibas_wg"`. `port` (default `3000`) adalah port **dashboard**, bukan port DB. Simpan file, lalu jalankan:

```powershell
.\Install_to_Windows_Service.bat
```

Jika pemasangan pertama tanpa opsi login, installer mencetak `admin` dan password acak **sekali** di terminal. Simpan password tersebut. Buka **http://127.0.0.1:3000/login** (ganti port jika diubah). Setelah login berhasil, aplikasi membuka dashboard. Dashboard Windows hanya tersedia di localhost.

```powershell
# Install/repair dan tetapkan login baru:
.\Install_to_Windows_Service.bat --user admin --pass "GANTI_DENGAN_PASSWORD_KUAT"

# Staging JIBAS: pasang trigger tetapi jangan pindahkan antrean baru:
.\Install_to_Windows_Service.bat --no-activate-move

# Ganti login saja, tanpa restart dan tanpa mengubah DB:
.\Install_to_Windows_Service.bat --credentials-only --user operator --pass-file "C:\Private\jibas-wg.pass"

# Lepas Windows Service; tidak menghapus konfigurasi, login, sesi, atau data:
.\Uninstall_Windows_Service.bat
```

## Ubuntu/Debian

Perlu systemd, `sudo`, Internet untuk dependensi, Python 3, dan `ss` dari `iproute2` (umumnya tersedia di instalasi standar). Bila sistem minimal belum punya keduanya: `sudo apt-get install -y python3 iproute2`. Gunakan clone atau ekstrak ZIP:

```bash
# Pilihan jika memakai Git; lewati jika sudah mengekstrak ZIP.
git clone https://github.com/smahud/WhatsAppGateway.git jibas-wg
cd jibas-wg
test -f config.json || cp config.example.json config.json
nano config.json
```

Isi `host`, `db_port`, `user`, dan `password` sesuai **database JIBAS**. Untuk instalasi baru gunakan `db_type: "mysql"` dan `database: "jibas_wg"`. `port` (default `3000`) adalah **port HTTPS dashboard**; port backend privat dipilih installer. Simpan file, lalu jalankan:

```bash
sudo bash install.sh
```

Untuk instalasi baru, installer memasang gateway dan worker di `/opt/jibas-wg`, serta Nginx untuk HTTPS. Pada pemasangan pertama tanpa opsi login, simpan password acak untuk `admin` yang ditampilkan terminal. Buka **https://IP_SERVER:3000/login**. Cocokkan fingerprint sertifikat awal yang dicetak installer. Untuk VPS dengan NAT gunakan `--address IP_PUBLIK_ATAU_DNS` saat install. Izinkan port HTTPS pada firewall provider; jangan mengekspos backend atau MySQL.

```bash
# Install/repair dengan login baru dan port HTTPS tertentu:
sudo bash install.sh --port 8443 --user admin --pass-file /root/jibas-wg.pass

# Staging JIBAS: pasang trigger tetapi jangan pindahkan antrean baru:
sudo bash install.sh --no-activate-move

# Ganti login saja:
sudo bash install.sh --credentials-only --user operator --pass-file /root/jibas-wg.pass

# Lepas unit JIBAS WG dan konfigurasi Nginx miliknya; simpan data:
sudo bash uninstall.sh
```

## Login dan perbaikan

| Opsi login | Instalasi baru | Instalasi yang sudah ada |
| --- | --- | --- |
| Tidak ada | `admin` + password acak | Pertahankan username dan password yang tersimpan |
| `--user NAMA` | NAMA + password acak | Ganti username dan buat password acak baru |
| `--pass …` atau `--pass-file PATH` | `admin` + password pilihan | Pertahankan username; ganti password |
| `--user` dan `--pass`/`--pass-file` | Gunakan keduanya | Ganti keduanya |

`--pass-file` menggunakan file privat UTF-8 satu baris dan menghindari password di shell history. Mengganti login memutus sesi dashboard lama, **bukan** sesi WhatsApp. Autentikasi berjalan melalui halaman `/login`, bukan dialog Basic Auth browser. Pengguna Linux lama dengan login Nginx bcrypt dapat menjalankan installer normal tanpa opsi login untuk memindahkan login lama.

**Jika port dipakai aplikasi lain**, installer berhenti sebelum pemasangan runtime/dependensi. Ubah `port` di `config.json` (bukan `db_port`), lalu jalankan ulang. Di Linux boleh memakai `--port`. **Jika port milik instalasi gateway yang sama**, installer memeriksa kepemilikan port dan DB, lalu melakukan restart terkontrol. Config, kredensial, sesi, dan antrean dipertahankan.

### Upgrade dari instalasi lama

- **Jangan ganti `database: "wagw"` pada konfigurasi lama.** Ini adalah nama schema kompatibilitas, bukan nama aplikasi. Installer menjaga schema, trigger, dan antrean lama; tidak membuat jalur MOVE kedua.
- **Windows:** perbarui source di folder instalasi lama tanpa menimpa `config.json`, `dashboard-auth.json`, atau `sessions/`. Rerun installer di folder yang sama untuk mengganti registrasi yang terverifikasi dari `wagwpro.exe` menjadi `JIBAS_WG.exe`.
- **Linux:** jalankan installer baru dari checkout/ZIP. Jika sudah terpasang di `/opt/wagw`, biarkan data di lokasi itu; unit dan konfigurasi Nginx diperbarui ke nama JIBAS WG. Gunakan `config.json` lama, atau biarkan installer memakai config terpasang. Lihat [panduan VPS](deployment/VPS.md#repair-rotasi-dan-uninstall).

## Cara pakai dari JIBAS

1. Login ke dashboard dan buka **Status JIBAS**. Tautkan akun melalui **WhatsApp → Perangkat tertaut** jika QR muncul.
2. Pastikan worker siap, MOVE aktif, dan WhatsApp terhubung. Kirim satu pesan teks dari **menu SMS JIBAS** ke nomor tester yang mengizinkan pengujian. Menu uji langsung di dashboard bukan pengujian alur JIBAS.
3. Pantau Outbox dan Sent. Pesan terjadwal baru berpindah pada waktunya. `sent` berarti library melaporkan pengiriman berhasil, bukan bukti pesan diterima atau dibaca. Konfirmasi di perangkat tujuan.

Jika instalasi ditahan karena antrean lama, gunakan staging `--no-activate-move`, lihat `uncaptured` pada `doctor.js`, lalu tinjau pesan bersama operator JIBAS. Setelah consumer SMS lama dihentikan dan antrean direkonsiliasi:

```powershell
# Windows: gunakan node portable jika ada; jika tidak, pakai runtime installer.
$Node = if (Test-Path .\node.exe) { '.\node.exe' } elseif (Test-Path .\.runtime\node\node.exe) { '.\.runtime\node\node.exe' } else { 'node.exe' }
& $Node .\deployment\doctor.js
& $Node .\deployment\activate.js
```

```bash
# Linux
sudo -u jibas-wg /opt/jibas-wg-runtime/node/bin/node /opt/jibas-wg/deployment/doctor.js
sudo -u jibas-wg /opt/jibas-wg-runtime/node/bin/node /opt/jibas-wg/deployment/activate.js
```

`pause.js` menjeda transfer baru; pesan yang sudah di antrean gateway tidak dibatalkan. Uninstall tidak melepas trigger atau mengembalikan pesan yang sudah dipindahkan. Jika ingin beralih kembali ke SMS lama, ikuti [rollback JIBAS](CONTRACT.md#penghentian-dan-rollback).

## Akun database JIBAS

Contoh untuk instalasi baru ketika JIBAS WG dan MariaDB berada pada mesin yang sama. Ganti password dan host akun jika gateway berada di mesin lain:

```sql
CREATE DATABASE IF NOT EXISTS jibas_wg CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'jibas_wg_app'@'127.0.0.1' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_DB_KUAT';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER ON jibas_wg.* TO 'jibas_wg_app'@'127.0.0.1';
GRANT SELECT, DELETE, TRIGGER ON jbssms.outbox TO 'jibas_wg_app'@'127.0.0.1';
```

Jangan impor dump `create tables/` ke database aktif; berkas asli mengandung `DROP TABLE`. Installer hanya memakai CREATE yang diperlukan, memasang trigger tanpa mengganti trigger berbeda, dan tidak menghapus riwayat `jbssms.outboxhistory`.

## Referensi dan diagnosa

- [Windows](deployment/WINDOWS.md): status service, log, dan perbaikan.
- [Linux](deployment/VPS.md): akses VPS, HTTPS, dan journal systemd.
- [Alur dan batas JIBAS](deployment/OUTBOX.md), [kontrak](CONTRACT.md), dan [audit](deployment/AUDIT.md).
- Windows `daemon/logs/`; Linux `sudo journalctl -u jibas-wg-gateway -u jibas-wg-bridge -n 60 --no-pager`.

Paket source Windows/Linux tanpa kredensial, sesi, atau runtime dapat dibangun dengan:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Build-Release.ps1
```

Jangan sertakan `config.json`, `dashboard-auth.json`, `.runtime/`, `sessions/`, database, log, atau PAT dalam Git. Untuk publikasi yang diizinkan ke repository pemilik proyek, commit hanya source yang ditinjau, lalu gunakan `deployment/Publish-GitHub.ps1` sesuai [kontrak publikasi](CONTRACT.md#kontrak-publikasi-git). Installer tidak melakukan commit atau push.
