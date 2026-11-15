# Deployment VPS — outbox JIBAS ke WhatsApp

Target panduan: Ubuntu/Debian dengan systemd, Node.js 22.14+ atau 24, npm, dan akses SSH. Audit dilakukan pada Windows/MariaDB; installer systemd belum dieksekusi pada Linux. Gunakan staging dan checklist penerimaan sebelum cutover produksi.

## Prasyarat yang harus dipenuhi

- Node dan npm dipasang dari sumber yang dipercaya; executable Node tersedia di `/usr/bin/node`, bukan hanya di nvm milik akun login.
- Database `jbssms` dan `wagw` harus berada pada **instance MySQL/MariaDB yang sama**. Aplikasi boleh berada di VPS terpisah dari instance DB, melalui jaringan privat/VPN. Desain move tidak mendukung dua server database terpisah.
- Tabel `jbssms.outbox` harus InnoDB dan memiliki struktur JIBAS yang sesuai. Installer tidak mengubah engine/tabel JIBAS secara otomatis.
- Backup JIBAS/WAGW tersedia dan cara restore telah diuji. Jangan memindahkan direktori data MariaDB mentah antar-server.
- Consumer SMS lama dihentikan sebelum aktivasi move. Jangan menjalankan Windows/local gateway dan VPS bersamaan pada antrean yang sama.
- Akses keluar ke WhatsApp dan npm tersedia. Browser admin memerlukan akses CDN untuk library QR/font dashboard.
- Profil instalasi di bawah ditujukan untuk **outbox teks SMS**. Driver database non-MySQL dan binary opsional pengolah media tidak dipasang. Gambar/dokumen dan fitur di luar outbox teks perlu profil dependency serta pengujian tersendiri.

## 1. Pindahkan paket source

Gunakan ZIP dari `deployment/Build-Release.ps1`, atau checkout commit/release yang sudah diperiksa. Jangan salin node_modules Windows ke Linux. ZIP tidak membawa config.json, sesi WhatsApp, database, log, atau node.exe.

Untuk **instalasi baru**, letakkan source langsung di `/opt/wagw`:

```bash
sudo install -d -m 750 /opt/wagw
sudo unzip /tmp/wagw-vps.zip -d /opt/wagw
cd /opt/wagw
sudo cp config.example.json config.json
sudo chmod 600 config.json
sudoedit config.json
```

Sesuaikan nama ZIP. Untuk upgrade, gunakan prosedur maintenance di bawah; jangan menimpa direktori aktif.

## 2. Siapkan database dan konfigurasi

Contoh konfigurasi aman tersedia di `config.example.json`. Isi password aktual hanya di `config.json`.

- `host`: localhost/IP privat server database; bukan URL HTTP.
- `db_port`: port database, misalnya 3434 pada instalasi awal. Port standar server baru dapat berbeda.
- `database`: harus `wagw`; sumber harus `jbssms`.
- `timezone`: samakan dengan zona jadwal JIBAS, default `+07:00`. Driver dan SQL session memakai offset ini.
- `port`: port dashboard lokal, default 3000.
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

Pastikan consumer SMS lama sudah dihentikan. Jalankan dari `/opt/wagw`:

```bash
sudo bash deployment/linux/install.sh --activate-move
```

Skrip:

1. Memeriksa path dan runtime; menolak instalasi ulang ketika layanan masih aktif.
2. Menjalankan `npm ci --omit=dev --omit=optional` berdasarkan lockfile.
3. Menjalankan bootstrap non-destruktif: mengekstrak CREATE TABLE dari schema asli, tanpa DROP/DELETE/TRUNCATE; struktur yang tidak sesuai ditolak.
4. Memperlebar `sent.status` menjadi 20 karakter jika masih lebih pendek, agar `failed` dapat disimpan.
5. Memasang trigger hanya jika belum ada; definisi berbeda ditolak, tidak diganti diam-diam.
6. Memeriksa engine, sumber yang belum tertangkap, mode, timezone, dan akses DB.
7. Membuat user Linux `wagw`; kode root-owned, sesi/config hanya dapat ditulis oleh user layanan.
8. Mengaktifkan move jika flag diberikan, lalu memasang dua layanan systemd (tanpa supervisor Node tambahan).

Tanpa `--activate-move`, instalasi baru tetap paused. Flag ini merupakan instruksi cutover: jangan gunakan sebelum consumer lama berhenti. Instalasi ulang tidak menonaktifkan bridge yang sudah aktif.

Jika ada outbox JIBAS lama yang belum memiliki capture, preflight berhenti. Rekonsiliasi/backfill perlu ditinjau secara eksplisit agar tidak mengirim ulang pesan lama.

## 4. Scan QR melalui SSH

Dashboard selalu bind ke `127.0.0.1`, karena gateway asli belum memiliki autentikasi. Dari komputer admin:

```bash
ssh -N -L 13000:127.0.0.1:3000 user@alamat-vps
```

Buka `http://localhost:13000` pada browser dan scan QR di WhatsApp > Perangkat tertaut. Jangan membuka port 3000 ke publik. Port lokal 13000 menghindari bentrok dengan dashboard Windows yang masih berjalan.

Untuk instalasi baru, lakukan pairing baru. Jangan menyalin sesi untuk menjalankan dua gateway memakai sesi yang sama. Backup `sessions/` bersifat sensitif dan harus terenkripsi/terbatas aksesnya.

## 5. Verifikasi penerimaan sebelum produksi

```bash
cd /opt/wagw
sudo -u wagw /usr/bin/node deployment/doctor.js
systemctl status wagw-gateway wagw-bridge
sudo journalctl -u wagw-gateway -n 50 --no-pager
sudo journalctl -u wagw-bridge -n 50 --no-pager
curl --fail http://127.0.0.1:3000/api/status
```

Pastikan:

- `doctor`: ok=true, bridgeEnabled=true, inboxEnabled=false, workerRunning=true.
- API status: ready=true dan dbConnected=true.
- Dashboard hanya mendengarkan pada loopback (`ss -ltnp`).
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
sudo bash deployment/linux/install.sh
```

Aktifkan kembali dengan `sudo -u wagw node deployment/activate.js` setelah pemeriksaan. Jika ingin sepenuhnya melepas integrasi, pause dan hentikan proses, kemudian lepaskan kedua trigger sebelum menghapus tabel WAGW. Mengembalikan pesan yang sudah dipindahkan harus direkonsiliasi manual; jangan bulk copy kembali pesan sent.

## Batas yang tetap ada

- Ini integrasi satu akun, outbox teks, satu instance DB. Inbox dan sinkronisasi hapus dua arah nonaktif.
- Atomic move menjamin perpindahan database, bukan exactly-once pengiriman WhatsApp. Crash sesudah send sebelum pencatatan sent masih memiliki celah kiriman ulang pada gateway asli.
- Gateway menyimpan hasil sent dan menghapus outbox sebagai dua operasi terpisah; kegagalan di antaranya memerlukan audit. Jangan menganggap `sent` sama dengan delivery/read receipt.
- Stop/restart WhatsApp lewat UI asli belum diaudit sebagai kontrol produksi; gunakan restart layanan systemd saat maintenance.
- Jalur OTA dan update library bawaan bukan prosedur upgrade produksi. Unit melindungi source read-only, tetapi pembaruan melalui UI tidak didukung; gunakan release teruji dan lockfile.
- Tidak ada klaim seluruh fitur SMS JIBAS telah digantikan. Perintah otomatis, PIN/nilai berbasis pesan, multimedia, dan fitur gateway lama memerlukan pengujian terpisah.

Referensi: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [MySQL CREATE TRIGGER](https://dev.mysql.com/doc/refman/8.4/en/create-trigger.html).
