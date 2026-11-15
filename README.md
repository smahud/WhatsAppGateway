# WAGW PRO — Integrasi Outbox SMS JIBAS

Repository: [smahud/WhatsAppGateway](https://github.com/smahud/WhatsAppGateway).

Gateway WhatsApp berbasis Node.js/Baileys dengan bridge database untuk memindahkan pesan keluar JIBAS ke WAGW. Source JIBAS dipertahankan; integrasi berada di `deployment/` dan objek database tambahan. Perubahan WAGW dibatasi pada pemuatan driver sesuai kebutuhan serta pengaman reconnect/scheduler hasil audit.

## Status implementasi

### Instalasi Linux otomatis

Untuk Ubuntu/Debian dengan systemd, clone repository lalu jalankan:

```bash
git clone https://github.com/smahud/WhatsAppGateway.git
cd WhatsAppGateway
sudo bash install.sh --port 3000 --user admin --pass somepassword
```

Ganti `somepassword` dengan password dashboard pilihan Anda. `--user`/`--pass` adalah login dashboard, **bukan** kredensial database. Password CLI dapat tercatat di shell history; alternatifnya gunakan `--pass-file /root/wagw-dashboard.pass`. Jika `--pass` tidak diberikan pada instalasi pertama, password acak dibuat dan ditampilkan sekali; instalasi berikutnya mempertahankan password lama.

Installer memasang paket OS, runtime Node.js khusus WAGW (tanpa mengganti Node aplikasi lain), dependency, schema/trigger WAGW, dua layanan startup, serta reverse proxy Nginx dengan HTTPS dan login. Source dipasang ke `/opt/wagw`. Bila `config.json` belum tersedia, installer meminta host, port, user, dan password **database JIBAS yang sudah ada** satu kali. `jbssms` dan `wagw` wajib berada pada instance DB yang sama; installer tidak memasang atau membuat JIBAS dari nol.

Sesudah berhasil, buka:

```text
https://IP_SERVER:3000
```

Login sebagai `admin` dengan password yang diberikan, lalu scan QR WhatsApp. Sertifikat awal self-signed; cocokkan fingerprint yang dicetak installer sebelum mempercayainya. Permintaan HTTP biasa diarahkan ke HTTPS pada port yang sama. Jika VPS memakai NAT, tentukan alamat publik dengan `--address IP_PUBLIK`. Buka port tersebut pada firewall provider; UFW yang sudah aktif diberi aturan untuk port pilihan tanpa mengaktifkan/reset firewall.

`--port 8080` menghasilkan `https://IP_SERVER:8080`. Port backend dipilih terpisah dan hanya mendengarkan di localhost. Mode MOVE aktif secara default: **hentikan consumer SMS lama sebelum memasang**. Untuk staging tanpa perpindahan pesan, tambahkan `--no-activate-move`. Installer menolak reinstall saat layanan WAGW masih aktif; pause, drain antrean, dan hentikan layanan dalam maintenance dahulu.

Panduan lengkap dan hak akses DB: [deployment/VPS.md](deployment/VPS.md). Validasi seluruh instalasi/boot tetap perlu dilakukan pada VPS tujuan; pengujian Windows tidak menggantikan penerimaan Linux.

Lingkup release ini: **satu akun WhatsApp, outbox teks JIBAS, mode move**. Tidak memerlukan Chrome, Playwright, atau Puppeteer. Koneksi WhatsApp memakai Baileys pihak ketiga, bukan WhatsApp Business Platform resmi Meta.

**Untuk VPS Linux, mulai dari [deployment/VPS.md](deployment/VPS.md).** Hasil dan batas audit tersedia di [deployment/AUDIT.md](deployment/AUDIT.md). Installer Linux disiapkan untuk staging; boot/systemd dan clean install Linux belum diuji dari sesi Windows ini.

- **Outbox: move aktif.** Ketika jadwalnya tiba, pesan dimasukkan ke antrean WAGW dan dihapus dari antrean JIBAS dalam satu transaksi.
- **Inbox: nonaktif.** Sinkronisasi pesan baru dan penghapusan dua arah belum diimplementasikan sebagai fitur yang siap digunakan.
- Riwayat `jbssms.outboxhistory` tetap dipertahankan.
- Instalasi lokal telah diuji pada Windows, Node.js 22.14.0, dan MariaDB 10.4.32 di port 3434.
- Pemasangan startup otomatis masih memerlukan Administrator; percobaan sesi awal ditolak Windows dan reboot belum diuji.

## Alur pesan

```text
JIBAS membuat jbssms.outbox
  -> trigger mencatat wagw.bridge_outgoing
  -> worker menunggu jadwal, mengunci sumber, memvalidasi pesan
  -> satu transaksi:
       INSERT wagw.outbox
       UPDATE referensi/status bridge
       DELETE jbssms.outbox
  -> WAGW mengirim WhatsApp
  -> wagw.sent -> status bridge
```

Mode ini memindahkan **antrean**, bukan menunggu pesan diterima HP. Pengiriman WhatsApp mengikuti scheduler WAGW. Jangan menjalankan consumer SMS lama pada antrean yang sama.

## Struktur

| Lokasi | Fungsi |
| --- | --- |
| `wabot.js`, `public/` | Backend dan dashboard WAGW; backend memakai pemuatan driver sesuai kebutuhan |
| `create tables/` | Schema database bawaan; mengandung DROP TABLE |
| `deployment/start-wagw.js` | Adapter port MySQL tanpa mengedit source gateway |
| `deployment/bridge.js` | Worker pemindahan outbox dan validasi |
| `deployment/bridge-schema.sql`, `setup-bridge.js` | Tabel kontrol/audit dan trigger database |
| `deployment/deploy.js` | Bootstrap database tanpa mengimpor ulang tabel yang sudah ada |
| `deployment/supervisor.js` | Menjalankan gateway/bridge dan memulai ulang child yang berhenti |
| `deployment/Start-WAGW.ps1`, `Stop-WAGW.ps1` | Kontrol proses lokal |
| `deployment/Install-Autostart.ps1` | Pendaftaran Task Scheduler saat startup |
| `deployment/test-bridge.js` | Uji transaksi dan perilaku bridge |
| `config.example.json` | Contoh konfigurasi tanpa kredensial |
| `CONTRACT.md` | Kontrak perilaku, batas perubahan, dan kriteria verifikasi |

## Instalasi Windows atau manual

Jalankan dari direktori proyek. Siapkan Node.js dan npm, MariaDB/MySQL, serta database JIBAS `jbssms` yang sudah tersedia pada server yang sama dengan `wagw`.

```powershell
npm ci --omit=optional
Copy-Item config.example.json config.json
```

Untuk instalasi portable, sediakan `node.exe` di root proyek. Skrip PowerShell menggunakan executable tersebut. `node.exe` dan `node_modules` tidak disimpan di Git. Gunakan runtime dan dependency native yang sesuai Windows/arsitektur mesin tujuan.

Profil minimal di atas untuk MySQL/outbox teks. Driver lain dan binary media opsional tidak ikut dipasang. Jika perlu engine lain, pasang dependency optional yang bersangkutan dan uji pada OS tujuan; jangan menyalin node_modules Windows ke Linux.

Edit `config.json` dengan host, `db_port`, user, dan password yang benar. `port` adalah port dashboard; `db_port` adalah port MySQL. Nama database integrasi saat ini harus `wagw` dan sumber harus `jbssms`.

```powershell
.\node.exe .\deployment\deploy.js
```

Bootstrap hanya mengekstrak CREATE TABLE dari schema asli ketika database WAGW belum berisi tabel; tidak menjalankan DROP dalam dump. Jika struktur database lama tidak sesuai, instalasi berhenti untuk pemeriksaan. Migrasi memperlebar `sent.status` menjadi 20 karakter agar `failed` muat. Ambil backup sebelum deployment pada instalasi lama. Tabel perpindahan harus InnoDB dan `jbssms`/`wagw` harus berada pada instance database yang sama.

Setelah memastikan consumer SMS lama tidak mengambil antrean tersebut, aktifkan melalui SQL:

```sql
UPDATE wagw.bridge_control
SET enabled=1, mode='whatsapp', inbox_enabled=0
WHERE id=1;
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Start-WAGW.ps1
```

Buka **http://localhost:3000**, lalu tautkan WhatsApp melalui QR. Sesi tersimpan dalam `sessions/`; biasanya tidak perlu scan ulang selama sesi tetap valid. Jangan menjalankan launcher/service bawaan bersamaan karena tidak memuat adapter port.

## Startup Windows

Di PowerShell **Administrator**, dari direktori proyek:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Install-Autostart.ps1
```

Skrip mendaftarkan task `WAGW-JIBAS-Bridge` sebagai SYSTEM saat boot. Task belum terpasang pada sesi awal. Setelah pemasangan, uji reboot, akses direktori proyek, kesiapan database, dan pemulihan sesi WhatsApp. Supervisor mengulang child yang berhenti; kegagalan inisialisasi database pada gateway yang tetap hidup masih perlu dipantau.

## Operasional dan pemeriksaan

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Stop-WAGW.ps1
.\node.exe .\deployment\test-bridge.js
.\node.exe .\deployment\test-deployment.js
.\node.exe .\deployment\doctor.js
Invoke-RestMethod http://localhost:3000/api/status
```

Test memakai transaksi rollback pada capture serta tabel sementara untuk pengujian perpindahan; tidak mengirim pesan WhatsApp. Gunakan kredensial pengujian yang sesuai karena tes membutuhkan akses schema dan tabel sumber.

```sql
SELECT * FROM wagw.bridge_control;
SELECT id,source_id,state,wagw_id,scheduled_at,error
FROM wagw.bridge_outgoing ORDER BY id DESC LIMIT 100;

-- Jeda transfer baru; pesan yang sudah di WAGW tetap diproses:
UPDATE wagw.bridge_control SET enabled=0 WHERE id=1;
```

Log berada di `deployment/gateway.log`, `bridge.log`, `supervisor.log`, dan `supervisor-error.log`. Jangan memakai `STOP.bat` bawaan: skrip tersebut mematikan semua `node.exe`.

## Batas yang perlu diketahui

Driver database dimuat ketika `db_type` tersebut dipakai, termasuk saat tes koneksi. Pada startup MySQL, driver Oracle, SQL Server, SQLite, dan ODBC tidak dimuat. Driver yang pernah dipakai tetap berada dalam cache Node.js sampai proses di-restart; dependensi tetap tercantum di package.json untuk mempertahankan dukungan engine lain. Uji tanpa koneksi nyata: `.\node.exe .\deployment\test-db-loading.js`.

- Tidak ada replay otomatis antrean sebelum trigger terpasang.
- Pesan kosong, nomor tidak valid, multipart/PDU, teks di atas 2000 karakter, dan awalan perintah khusus WAGW ditolak, bukan dihapus dari sumber.
- Edit sebelum transfer mengikuti sumber terbaru. Setelah transfer, perubahan riwayat JIBAS tidak mengubah pesan WAGW.
- `sent` berarti pengiriman berhasil menurut library, bukan bukti penerimaan atau pembacaan di HP.
- Tidak ada retry pengiriman otomatis. Crash gateway setelah mengirim tetapi sebelum mencatat hasil masih berpotensi menghasilkan kiriman ulang.
- Perintah otomatis SMS, PIN/nilai, kritik/saran, dan seluruh fitur SMS server lama belum dinyatakan kompatibel.
- API gateway asli belum memiliki autentikasi. Batasi akses dashboard/API pada lingkungan yang dipercaya; jangan mengeksposnya langsung ke internet.

Launcher deployment kini membatasi dashboard ke `127.0.0.1`, memeriksa database sebelum memulai WhatsApp, serta mencegah gateway kedua mengambil antrean yang sama melalui named lock. Akses dashboard VPS lewat SSH tunnel. Scheduler outbox dijaga tetap satu ketika reconnect; DB sehat tidak diinisialisasi ulang pada setiap reconnect WhatsApp.

## Git dan data lokal

Repository menyimpan source, dokumentasi, schema, dan contoh konfigurasi. Kredensial `config.json`, sesi WhatsApp, database, log, PID, backup lokal, dan executable tidak dilacak. Setelah clone, konfigurasi dan runtime perlu disiapkan lagi. Jangan menambahkan file tersebut dengan `git add -f`.

Tidak ada remote yang otomatis dibuat atau dipublikasikan. Ketentuan lisensi proyek asli belum ditemukan; dokumentasi ini tidak memberikan lisensi baru atas source tersebut.

Repository lokal menggunakan branch `main` dan commit awal sudah tersedia. Perubahan audit berikutnya perlu diperiksa dan di-commit sebelum dijadikan release Git. Dari terminal lokal yang dapat menulis repository:

```powershell
git status --short
git add .
git diff --cached --stat
git commit -m "Harden WAGW JIBAS deployment and add VPS installer"
```

Jika Git meminta identitas, atur `user.name` dan `user.email` milik Anda pada repository sebelum commit.

### Publikasi ke repository GitHub yang sudah ada

Pastikan repository tujuan berada pada akun `smahud` dan PAT memiliki akses tulis ke repository tersebut. Nama repo tidak harus sama dengan direktori proyek. Konfigurasi PAT dibaca dari `Documents/github.pat.json` pada properti `smahud`, bukan disalin ke dalam proyek.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Publish-GitHub.ps1 -Repository WhatsAppGateway
```

Skrip memverifikasi akun, memeriksa kandidat file terhadap kredensial lokal, membuat commit jika ada perubahan, dan push branch `main` tanpa force. Token hanya digunakan dalam header proses; tidak ditulis ke URL origin atau konfigurasi Git. Repository yang tidak ditemukan/diizinkan menyebabkan proses berhenti. Repo baru hanya dibuat jika operator secara eksplisit menambahkan `-CreatePrivateRepository`; repo public memerlukan `-AllowPublic` setelah isi diperiksa.

Repository GitHub private perlu diizinkan pada PAT yang digunakan dan, jika memakai koneksi GitHub ChatGPT, pada koneksi tersebut juga. Menyiapkan file atau commit lokal tidak membuktikan push berhasil; verifikasi commit di GitHub sebelum deployment.

Catatan teknis lebih lanjut: [deployment/OUTBOX.md](deployment/OUTBOX.md). Kontrak implementasi: [CONTRACT.md](CONTRACT.md).
