# WAGW PRO — Integrasi Outbox SMS JIBAS

Gateway WhatsApp berbasis Node.js/Baileys dengan bridge database untuk memindahkan pesan keluar JIBAS ke WAGW. Source asli WAGW dan JIBAS dipertahankan; integrasi berada di `deployment/` dan objek database tambahan.

## Status implementasi

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
| `wabot.js`, `public/` | Backend dan dashboard asli WAGW |
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

## Instalasi baru

Jalankan dari direktori proyek. Siapkan Node.js dan npm, MariaDB/MySQL, serta database JIBAS `jbssms` yang sudah tersedia pada server yang sama dengan `wagw`.

```powershell
npm ci
Copy-Item config.example.json config.json
```

Untuk instalasi portable, sediakan `node.exe` di root proyek. Skrip PowerShell menggunakan executable tersebut. `node.exe` dan `node_modules` tidak disimpan di Git. Gunakan runtime dan dependency native yang sesuai Windows/arsitektur mesin tujuan.

Edit `config.json` dengan host, `db_port`, user, dan password yang benar. `port` adalah port dashboard; `db_port` adalah port MySQL. Nama database integrasi saat ini harus `wagw` dan sumber harus `jbssms`.

```powershell
.\node.exe .\deployment\deploy.js
```

Bootstrap mengimpor schema asli hanya jika database WAGW belum memiliki tabel. Jangan mengimpor manual SQL bawaan pada database yang sudah berisi data. Ambil backup database sebelum deployment pada instalasi lama. Tabel `jbssms.outbox`, `wagw.outbox`, dan `wagw.bridge_outgoing` harus InnoDB.

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

- Tidak ada replay otomatis antrean sebelum trigger terpasang.
- Pesan kosong, nomor tidak valid, multipart/PDU, teks di atas 2000 karakter, dan awalan perintah khusus WAGW ditolak, bukan dihapus dari sumber.
- Edit sebelum transfer mengikuti sumber terbaru. Setelah transfer, perubahan riwayat JIBAS tidak mengubah pesan WAGW.
- `sent` berarti pengiriman berhasil menurut library, bukan bukti penerimaan atau pembacaan di HP.
- Tidak ada retry pengiriman otomatis. Crash gateway setelah mengirim tetapi sebelum mencatat hasil masih berpotensi menghasilkan kiriman ulang.
- Perintah otomatis SMS, PIN/nilai, kritik/saran, dan seluruh fitur SMS server lama belum dinyatakan kompatibel.
- API gateway asli belum memiliki autentikasi. Batasi akses dashboard/API pada lingkungan yang dipercaya; jangan mengeksposnya langsung ke internet.

## Git dan data lokal

Repository menyimpan source, dokumentasi, schema, dan contoh konfigurasi. Kredensial `config.json`, sesi WhatsApp, database, log, PID, backup lokal, dan executable tidak dilacak. Setelah clone, konfigurasi dan runtime perlu disiapkan lagi. Jangan menambahkan file tersebut dengan `git add -f`.

Tidak ada remote yang otomatis dibuat atau dipublikasikan. Ketentuan lisensi proyek asli belum ditemukan; dokumentasi ini tidak memberikan lisensi baru atas source tersebut.

Repository lokal telah diinisialisasi pada branch `main`. Commit awal belum dibuat karena sesi pengaturan tidak mendapat izin menulis `.git/index.lock`. Dari terminal lokal yang dapat menulis repository, periksa daftar file terlebih dahulu lalu buat commit:

```powershell
git status --short
git add .
git diff --cached --stat
git commit -m "Initial WAGW JIBAS outbox move integration"
```

Jika Git meminta identitas, atur `user.name` dan `user.email` milik Anda pada repository sebelum commit.

Catatan teknis lebih lanjut: [deployment/OUTBOX.md](deployment/OUTBOX.md). Kontrak implementasi: [CONTRACT.md](CONTRACT.md).
