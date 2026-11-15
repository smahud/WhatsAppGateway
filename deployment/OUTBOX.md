# Status integrasi outbox

Dokumen ini menggantikan catatan status instalasi awal dalam README.md.

Pembaruan audit VPS: panduan terbaru di [VPS.md](VPS.md) dan [AUDIT.md](AUDIT.md). Bootstrap sekarang mengekstrak CREATE TABLE tanpa DROP, trigger dibuat secara portabel tanpa replace, dan sent.status diperlebar ke 20 karakter. Launcher membatasi bind localhost serta menambahkan preflight/lock gateway. Langkah deployment lama di bawah dilengkapi oleh panduan tersebut.

## Yang sudah aktif

- Source JIBAS tetap asli. Perubahan WAGW dibatasi pada pemuatan driver serta pengaman reconnect/scheduler hasil audit. Integrasi outbox tetap di deployment, konfigurasi di config.json, dan mapping/trigger/tabel pada database.
- MariaDB 127.0.0.1:3434, database wagw; kredensial dibaca dari config.json.
- Trigger AFTER INSERT jbssms.outbox menyalin pesan ke wagw.bridge_outgoing dalam transaksi yang sama. Gateway SMS yang cepat menghapus outbox tidak membuat salinan hilang.
- Worker mengambil pesan yang jadwalnya sudah tiba, mengunci baris sumber JIBAS, memvalidasi nomor dan teks terbaru, lalu dalam satu transaksi menulis wagw.outbox, mencatat referensi ID, dan menghapus baris jbssms.outbox. Kegagalan pada salah satu langkah membatalkan semuanya. Pesan gagal validasi tetap di JIBAS dan dicatat rejected beserta alasannya.
- Worker tunggal dikunci dengan GET_LOCK. Pengulangan polling tidak membuat antrean WAGW ganda.
- Status hasil di wagw.sent disalin ke bridge_outgoing sebagai sent/failed. Tidak ada retry otomatis yang berpotensi menggandakan kiriman.
- Trigger UPDATE memperbarui pesan/nomor/jadwal sebelum bridge mengantrekannya.
- Supervisor menjalankan gateway dan bridge, serta memulai ulang child yang berhenti.
- Mode saat ini whatsapp (move): pesan baru berpindah dari antrean JIBAS ke WAGW ketika jadwalnya tiba. outboxhistory tidak dihapus dan status SMS tidak dipalsukan. Mode mirror ditolak worker ini.
- Inbox forwarding nonaktif sesuai arahan fokus outbox.

Alur: JIBAS (pengumuman, presensi, nilai, kirim ulang, balasan) -> jbssms.outbox -> capture trigger -> bridge_outgoing -> transaksi INSERT wagw.outbox + receipt + DELETE jbssms.outbox -> WhatsApp -> wagw.sent -> status bridge.

Pembaruan mode move: uji terisolasi lulus untuk penghapusan sumber setelah enqueue, rollback destination/receipt saat DELETE gagal, retry tanpa antrean ganda, sumber hilang tidak dikirim, sumber invalid tetap disimpan, jadwal dan status. Tidak ada pesan eksternal baru dalam uji mode move. Tes langsung sebelumnya di bawah merupakan tes mode copy sebelum perubahan ini.

## Batas kompatibilitas

Uji end-to-end 13 November 2026 berhasil: jbssms.outbox ID 3 -> wagw.outbox/sent ID 3, status bridge sent, nomor tester yang disetujui (disamarkan pada dokumentasi publik). Baris sumber khusus uji dibersihkan setelah sent agar tidak dikirim ulang sebagai SMS oleh layanan lama; audit bridge dan sent dipertahankan. Uji terisolasi juga lulus untuk capture/update, rollback, jadwal, deduplikasi antrean, validasi, dan sinkronisasi status. Penerimaan uji integrasi di HP belum dikonfirmasi pengguna.

- Penghapusan riwayat di JIBAS tidak otomatis membatalkan pesan WhatsApp. JIBAS menghapus outboxhistory, sedangkan gateway SMS juga dapat menghapus outbox sebagai proses normal; keduanya tidak aman disamakan dengan pembatalan.
- Pesan yang sudah queued tidak lagi berada di outbox JIBAS dan tidak mengikuti edit riwayat berikutnya. Resend JIBAS membuat ID sumber baru sehingga diperlakukan sebagai kiriman baru. Perbaikan sumber rejected melalui UPDATE mengembalikannya ke pending.
- Multipart/PDU ditolak untuk pemeriksaan manual. Pesan teks >2000 karakter ditolak agar tidak terpotong schema asli WAGW. Pesan berawalan perintah khusus WAGW ditolak untuk mencegah interpretasi yang tidak dimaksudkan.
- Status sent berarti library WhatsApp berhasil mengirim, bukan delivery report operator. Tidak disalin menjadi status sentitems JIBAS.
- Tepat satu pengiriman jaringan tidak dapat dijamin apabila WAGW crash setelah mengirim tetapi sebelum mencatat sent; ini batas implementasi gateway asli.
- Perintah otomatis nilai/PIN, kritik/saran, media masuk, dan seluruh fitur SMS server lama belum diverifikasi. Tidak diklaim seluruh fitur SMS telah digantikan.
- Tidak ada backfill pesan lama otomatis. Hanya INSERT baru setelah pemasangan trigger yang ditangkap.
- Jika sumber sudah tidak ada saat worker mengambilnya, job menjadi cancelled dan tidak dikirim. Pesan mode copy lama yang sudah sent tidak dipindahkan ulang.
- Semua tabel perpindahan harus InnoDB; worker menolak berjalan jika engine tidak mendukung transaksi.
- Tidak terdeteksi consumer SMS lama aktif pada pemeriksaan; daemons kosong, phones terakhir diperbarui tahun 2010, dan tidak ada koneksi database SMS aktif. Jangan mengaktifkan consumer SMS lain pada antrean yang sama: lock database tidak mencegah consumer tersebut mengirim SMS di luar transaksi sebelum menghapus baris.
- Trigger menambah ketergantungan transaksi JIBAS pada tabel bridge: jangan menghapus wagw sebelum melepas kedua trigger.

## Operasional

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Start-WAGW.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Stop-WAGW.ps1
.\node.exe .\deployment\test-bridge.js
```

Dashboard http://localhost:3000. Sesi WhatsApp dipertahankan di sessions; QR hanya dibutuhkan jika sesi belum tertaut atau logout.
Log: deployment/gateway.log, bridge.log, supervisor.log, supervisor-error.log.

Pemantauan:

```sql
SELECT id,source_id,state,wagw_id,error,scheduled_at FROM wagw.bridge_outgoing ORDER BY id DESC;
SELECT * FROM wagw.bridge_control;
-- Jeda kiriman bridge baru; antrean yang sudah di WAGW tetap diproses:
UPDATE wagw.bridge_control SET enabled=0 WHERE id=1;
-- Aktifkan mode move:
UPDATE wagw.bridge_control SET enabled=1,mode='whatsapp',inbox_enabled=0 WHERE id=1;
```

## Deployment berikutnya

1. Salin proyek beserta node.exe dan node_modules yang sesuai Windows. Jangan menyertakan sesi sessions atau log berisi pesan pribadi dalam paket untuk komputer lain.
2. Isi config.json sesuai server: db_type=mysql, host, db_port, database=wagw, user, password, port=3000. Server JIBAS harus sudah memiliki jbssms.
3. Jalankan `.\node.exe .\deployment\deploy.js`. Database baru dibuat dan schema asli diimpor hanya jika belum berisi tabel. Database lama tidak di-drop; kekurangan schema memerlukan pemeriksaan.
4. Pastikan consumer SMS lama tidak mengakses antrean ini, kemudian aktifkan bridge dengan SQL mode move di atas.
5. Di PowerShell **Administrator**, jalankan `powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Install-Autostart.ps1` untuk task startup SYSTEM. Skrip ini tidak menyimpan password database ke Task Scheduler.
6. Jalankan Start-WAGW.ps1 dan scan QR di dashboard. Jangan menjalankan START.bat atau installer service asli bersamaan karena keduanya melewati adapter port.

Pendaftaran startup pada sesi ini mendapat Access denied dari Windows; task belum terpasang. Setelah instalasi Administrator, reboot harus diuji untuk memverifikasi akses folder, database yang terlambat siap, dan pemulihan sesi WhatsApp.

## Rollback integrasi

Jeda bridge, hentikan supervisor, dan pastikan antrean WAGW sudah diperiksa.
Lepaskan `jbssms.wagw_capture_outbox` dan `jbssms.wagw_update_outbox` sebelum menghapus tabel bridge. Jangan hapus jbssms atau tabel pesan/riwayat asli. Simpan bridge_outgoing untuk audit. Jangan mengimpor ulang SQL bawaan ke database berisi data karena memiliki DROP TABLE.
