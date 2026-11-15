# Deployment VPS — outbox JIBAS ke WhatsApp

Target panduan: Ubuntu/Debian dengan systemd dan akses sudo/SSH. Installer memasang runtime Node.js khusus WAGW, dependency, HTTPS/login, serta layanan startup. Validasi boot dan koneksi DB pada VPS tujuan tetap diperlukan.

## Prasyarat yang harus dipenuhi

- Paket OS dipasang melalui apt. Runtime Node.js dipasang dari distribusi resmi HTTPS dengan pemeriksaan SHA256 di `/opt/wagw-runtime/node`; Node aplikasi lain tidak diganti.
- Database `jbssms` dan `wagw` harus berada pada **instance MySQL/MariaDB yang sama**. Aplikasi boleh berada di VPS terpisah dari instance DB, melalui jaringan privat/VPN. Desain move tidak mendukung dua server database terpisah.
- Tabel `jbssms.outbox` harus InnoDB dan memiliki struktur JIBAS yang sesuai. Installer tidak mengubah engine/tabel JIBAS secara otomatis.
- Backup JIBAS/WAGW tersedia dan cara restore telah diuji. Jangan memindahkan direktori data MariaDB mentah antar-server.
- Consumer SMS lama dihentikan sebelum aktivasi move. Jangan menjalankan Windows/local gateway dan VPS bersamaan pada antrean yang sama.
- Akses keluar ke WhatsApp dan npm tersedia. Browser admin memerlukan akses CDN untuk library QR/font dashboard.
- Profil instalasi di bawah ditujukan untuk **outbox teks SMS**. Driver database non-MySQL dan binary opsional pengolah media tidak dipasang. Gambar/dokumen dan fitur di luar outbox teks perlu profil dependency serta pengujian tersendiri.

## 1. Pindahkan paket source

Gunakan ZIP dari `deployment/Build-Release.ps1`, atau checkout commit/release yang sudah diperiksa. Jangan salin node_modules Windows ke Linux. ZIP tidak membawa config.json, sesi WhatsApp, database, log, atau node.exe.

Untuk **instalasi baru**, clone lalu jalankan installer dari folder clone:

```bash
git clone https://github.com/smahud/WhatsAppGateway.git
cd WhatsAppGateway
sudo bash install.sh --port 3000 --user admin --pass somepassword
```

Source akan dipasang ke `/opt/wagw`. ZIP juga dapat diekstrak ke folder biasa lalu dipasang dengan perintah yang sama. Ganti `somepassword`; itu password dashboard, bukan DB. Untuk upgrade, gunakan maintenance di bawah.

## 2. Siapkan database dan konfigurasi

Saat config belum ada, installer meminta detail koneksi DB satu kali melalui terminal; password tidak ditampilkan. Config yang sudah ada dipertahankan. Untuk unattended install, siapkan config.json lebih dulu atau gunakan `--db-host`, `--db-port`, `--db-user`, dan `--db-password-file /root/jibas-db.pass`. File password harus dijaga hanya dapat dibaca root.

- `host`: localhost/IP privat server database; bukan URL HTTP.
- `db_port`: port database, misalnya 3434 pada instalasi awal. Port standar server baru dapat berbeda.
- `database`: harus `wagw`; sumber harus `jbssms`.
- `timezone`: samakan dengan zona jadwal JIBAS, default `+07:00`. Driver dan SQL session memakai offset ini.
- `port`: port backend privat yang dipilih installer (mulai 39000).
- `public_port`: port HTTPS publik, ditentukan `--port`.
- `webhook_url` dan `bot_exe`: kosong untuk deployment outbox ini. Path EXE Windows tidak berlaku di Linux.

Periksa juga timezone PHP/JIBAS dan sesi database JIBAS pada server tujuan. Setting timezone worker tidak memperbaiki timestamp yang sudah ditulis salah oleh aplikasi sumber; verifikasi satu jadwal nyata di staging sebelum cutover.

Gunakan akun database khusus. Contoh berikut dijalankan oleh administrator database, dengan password baru yang kuat:

```sql
CREATE USER 'wagw_app'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_KUAT';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, CREATE TEMPORARY TABLES
  ON wagw.* TO 'wagw_app'@'localhost';
GRANT SELECT, DELETE, TRIGGER
  ON jbssms.outbox TO 'wagw_app'@'localhost';
```

Untuk DB remote, gunakan host akun yang sesuai alamat privat VPS, bukan wildcard `%`, dan batasi firewall/jaringan DB. Jangan membuka MySQL tanpa proteksi di internet. Profil ini tidak mengonfigurasi TLS DB otomatis; gunakan jaringan privat/VPN yang aman atau rancang konfigurasi TLS sebelum koneksi publik.

Hak CREATE/ALTER dibutuhkan saat bootstrap/migrasi WAGW. Sesudah selesai dapat dicabut dan diberikan sementara lagi untuk upgrade. Hak TRIGGER tetap diperlukan oleh preflight untuk melihat metadata trigger. Definer trigger harus tetap berupa akun DB yang valid; jangan hapus akun tersebut setelah pemasangan.

```sql
REVOKE CREATE, ALTER ON wagw.* FROM 'wagw_app'@'localhost';
```

Lakukan pencabutan setelah installer berhasil, bukan sebelum bootstrap pertama. Tes yang menulis sumber JIBAS tidak dijalankan memakai akun runtime di produksi.

## 3. Instalasi layanan

Pastikan consumer SMS lama sudah dihentikan. Jalankan dari folder source:

```bash
sudo bash install.sh --port 3000 --user admin --pass somepassword
```

Skrip:

1. Memeriksa opsi dan port; menolak instalasi ulang ketika layanan masih aktif.
2. Memasang paket OS, Node khusus WAGW, lalu `npm ci --omit=dev --omit=optional` berdasarkan lockfile.
3. Menjalankan bootstrap non-destruktif: mengekstrak CREATE TABLE dari schema asli, tanpa DROP/DELETE/TRUNCATE; struktur yang tidak sesuai ditolak.
4. Memperlebar `sent.status` menjadi 20 karakter jika masih lebih pendek, agar `failed` dapat disimpan.
5. Memasang trigger hanya jika belum ada; definisi berbeda ditolak, tidak diganti diam-diam.
6. Memeriksa engine, sumber yang belum tertangkap, mode, timezone, dan akses DB.
7. Membuat user Linux `wagw`; kode root-owned, sesi/config hanya dapat ditulis oleh user layanan.
8. Menyiapkan login bcrypt, sertifikat TLS, Nginx, dua layanan systemd, serta akses port pada UFW jika sudah aktif.
9. Mengaktifkan MOVE default, memeriksa backend dan perlindungan login (HTTP 401), lalu mencetak alamat akses.

MOVE aktif default; consumer SMS lama harus sudah berhenti. Tambahkan `--no-activate-move` untuk staging paused. `--user` tanpa `--pass` mempertahankan login lama; perubahan username harus disertai password baru. Pada instalasi pertama tanpa password, installer membuat password acak dan menampilkannya sekali.

Jika ada outbox JIBAS lama yang belum memiliki capture, preflight berhenti. Rekonsiliasi/backfill perlu ditinjau secara eksplisit agar tidak mengirim ulang pesan lama.

## 4. Login di IP:PORT lalu scan QR

Backend tetap localhost. Nginx menyediakan HTTPS/login pada port yang Anda pilih:

```bash
https://IP_SERVER:3000
```

Login menggunakan `--user`/`--pass`, lalu scan QR di WhatsApp > Perangkat tertaut. Sertifikat awal self-signed: cocokkan fingerprint yang dicetak installer sebelum mempercayainya di browser. HTTP biasa diarahkan ke HTTPS pada port yang sama. NAT/VPS dengan IP privat dapat memakai `--address IP_PUBLIK` agar alamat/certificate sesuai. Buka TCP port tersebut pada firewall provider; installer hanya dapat mengatur UFW lokal yang sudah aktif, tidak security group provider.

Password CLI dapat tercatat dalam history/daftar proses. Alternatif: `--pass-file /root/wagw-dashboard.pass`. Password dashboard disimpan dalam bentuk hash di `/etc/wagw/dashboard.htpasswd`; database memakai kredensial terpisah di config.json. Sertifikat/key ada di `/etc/wagw`. Jangan sertakan folder tersebut dalam source Git.

Untuk instalasi baru, lakukan pairing baru. Jangan menyalin sesi untuk menjalankan dua gateway memakai sesi yang sama. Backup `sessions/` bersifat sensitif dan harus terenkripsi/terbatas aksesnya.

## 5. Verifikasi penerimaan sebelum produksi

```bash
cd /opt/wagw
sudo -u wagw /opt/wagw-runtime/node/bin/node deployment/doctor.js
systemctl status wagw-gateway wagw-bridge
sudo journalctl -u wagw-gateway -n 50 --no-pager
sudo journalctl -u wagw-bridge -n 50 --no-pager
BACKEND=$(sudo /opt/wagw-runtime/node/bin/node -p 'require("./config.json").port')
curl --fail "http://127.0.0.1:$BACKEND/api/status"
```

Pastikan:

- `doctor`: ok=true, bridgeEnabled=true, inboxEnabled=false, workerRunning=true.
- API status: ready=true dan dbConnected=true.
- Backend hanya pada loopback; port publik melalui Nginx harus meminta login (401 sebelum autentikasi).
- Satu pesan **ke nomor tester yang disetujui** dibuat dari UI JIBAS, bukan hanya API WAGW. Saat due, sumber hilang, ID tujuan tercatat, lalu status menjadi sent; penerimaan di HP dikonfirmasi.
- Pesan terjadwal tidak pindah sebelum waktunya; pesan tidak valid tetap berada di sumber.
- Restart layanan dan reboot VPS tidak menggandakan enqueue atau meminta QR ulang selama sesi masih valid.
- Simulasi database belum siap dilakukan di staging: gateway harus gagal startup/restart, bridge reconnect, lalu pulih ketika database siap.

Audit Windows telah memverifikasi transaksi move dan status dengan tabel sementara tanpa pesan eksternal baru. Reboot Linux, clean npm install lintas-platform, systemd, dan delivery mode move pada VPS **belum** diverifikasi.

## Operasional, maintenance, dan rollback

Log systemd dapat berisi nomor/pesan/QR. Batasi akses journal dan atur retensi journal pada kebijakan server. Jangan membagikan log atau config di tiket publik.

```sql
-- Pause transfer baru; job yang sudah di WAGW tetap dapat dikirim.
UPDATE wagw.bridge_control SET enabled=0 WHERE id=1;
SELECT id,source_id,state,wagw_id,error FROM wagw.bridge_outgoing ORDER BY id DESC LIMIT 100;
SELECT COUNT(*) AS remaining FROM wagw.outbox;
```

Untuk cutover dari Windows atau upgrade: pause bridge, tunggu antrean WAGW dan kiriman in-flight selesai, hentikan layanan/proses lama, backup source/config/sesi/database, lalu upgrade dependency dan bootstrap saat maintenance. Jangan `npm ci` pada direktori dengan proses aktif. Installer menolak layanan systemd yang masih aktif; pemeriksaan operator tetap diperlukan untuk proses manual atau container lain.

```bash
sudo systemctl stop wagw-gateway wagw-bridge
# Upgrade source; jalankan installer sesudah pemeriksaan backup/schema.
sudo bash install.sh --port 3000 --no-activate-move
```

Aktifkan kembali dengan `sudo -u wagw /opt/wagw-runtime/node/bin/node deployment/activate.js` setelah pemeriksaan. Jika ingin sepenuhnya melepas integrasi, pause dan hentikan proses, kemudian lepaskan kedua trigger sebelum menghapus tabel WAGW. Mengembalikan pesan yang sudah dipindahkan harus direkonsiliasi manual; jangan bulk copy kembali pesan sent.

## Batas yang tetap ada

- Ini integrasi satu akun, outbox teks, satu instance DB. Inbox dan sinkronisasi hapus dua arah nonaktif.
- Atomic move menjamin perpindahan database, bukan exactly-once pengiriman WhatsApp. Crash sesudah send sebelum pencatatan sent masih memiliki celah kiriman ulang pada gateway asli.
- Gateway menyimpan hasil sent dan menghapus outbox sebagai dua operasi terpisah; kegagalan di antaranya memerlukan audit. Jangan menganggap `sent` sama dengan delivery/read receipt.
- Stop/restart WhatsApp lewat UI asli belum diaudit sebagai kontrol produksi; gunakan restart layanan systemd saat maintenance.
- Jalur OTA dan update library bawaan bukan prosedur upgrade produksi. Unit melindungi source read-only, tetapi pembaruan melalui UI tidak didukung; gunakan release teruji dan lockfile.
- Tidak ada klaim seluruh fitur SMS JIBAS telah digantikan. Perintah otomatis, PIN/nilai berbasis pesan, multimedia, dan fitur gateway lama memerlukan pengujian terpisah.

Referensi: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [MySQL CREATE TRIGGER](https://dev.mysql.com/doc/refman/8.4/en/create-trigger.html).
