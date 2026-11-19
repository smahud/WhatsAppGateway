# Audit JIBAS WhatsApp Gateway

## Perbaikan yang diuji ulang

| Area | Perubahan dan bukti |
| --- | --- |
| Identitas | Dashboard, login, pairing, paket npm/ZIP, serta nama layanan baru memakai JIBAS WhatsApp Gateway. Upgrade mempertahankan path data lama, hash login dan schema lama. |
| Dependensi | Perbarui Baileys, Express, mysql2, dan dependensi transitif sesuai lockfile. Instalasi npm tidak memerlukan Git untuk libsignal. `npm audit --omit=dev` tidak melaporkan kerentanan pada lockfile ini saat audit. |
| Cakupan database | Driver dan dump schema Oracle, SQL Server, ODBC, serta SQLite yang tidak dipakai dihapus. Gateway dan dashboard hanya menerima MySQL/MariaDB; `db_type` lain ditolak sebelum koneksi. |
| Dashboard | Login form dan cookie server-side diuji untuk redirect, password lama bcrypt/scrypt, rotasi, logout, dan Origin. QR dirender lokal, diperbarui otomatis, dan membutuhkan login. Uji langsung dibatasi ke teks; jalur OTA dan webhook/bot bawaan yang bukan bagian dari MOVE dihapus. |
| Database | Bootstrap tidak mengimpor `DROP TABLE`; read-only preflight menolak antrean lama, trigger berbeda, dan schema bersaing. Uji SQL mencakup capture/update, penjadwalan, invalid, sumber hilang, rollback DELETE, deduplikasi antrean, dan pencatatan hasil. Schema legacy juga diuji dengan grant pengguna aplikasi dari README. |
| Keutuhan kiriman | Retry penulisan receipt dalam proses yang sama tidak mengirim ulang; hasil INSERT dan penghapusan outbox dicatat dalam satu transaksi MySQL. Batas crash antar sistem tetap berlaku. |
| Installer dan packaging | Fixture Windows lulus konflik port, instalasi/repair, migrasi SCM yang dimiliki, password-file, dan uninstall. [Ubuntu 24.04 di GitHub Actions](https://github.com/smahud/WhatsAppGateway/actions/workflows/linux-installer.yml) lulus instalasi systemd, HTTPS Nginx, repair, restart unit, migrasi konfigurasi/login legacy, uninstall, dan uji SQL. ZIP tidak memuat konfigurasi lokal, PAT, sesi, runtime, atau log. |

`npm test` tidak menyentuh DB atau WhatsApp. `deployment/test-bridge.js` dan `deployment/test-jibas-e2e.js` memakai DB disposable: yang terakhir memakai trigger/worker/gateway asli, tetapi socket WhatsApp tiruan. Bukti dari socket tiruan bukan bukti pengiriman atau penerimaan di HP.

## Migrasi installer Windows

Commit `e48f2cc` memperkenalkan entry point PowerShell. Installer dan uninstaller publik sekarang memakai `.ps1`; mekanisme WinSW, schema lama, dan launcher yang dirujuk service tetap dipertahankan. Pengujian sebelumnya memakai entry point batch; fixture Windows kini memanggil `.ps1`. Panduan upgrade dan diagnosa disatukan di [Windows](WINDOWS.md#upgrade-di-folder-yang-sama), sedangkan riwayat lengkap tetap tersedia di Git.

## Gerbang produksi

Lakukan backup, pastikan consumer SMS lama sudah berhenti, dan rekonsiliasi `uncaptured` sebelum mengaktifkan MOVE. Jalankan installer pada OS tujuan, uji reboot, tautkan ulang hanya bila sesi tidak berlaku, lalu konfirmasi satu pesan **dari menu SMS JIBAS** pada nomor yang disetujui. Jangan menyalin credential atau isi pesan ke log publik. Audit ini bukan jaminan kompatibilitas semua versi MySQL, semua host Linux, atau exactly-once delivery.
