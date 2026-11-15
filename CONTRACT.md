# Kontrak Implementasi Integrasi JIBAS–WAGW

Dokumen ini menetapkan perilaku teknis integrasi yang disepakati pada proyek ini. Ini bukan kontrak hukum atau pemberian lisensi atas source asli.

Status dokumentasi: 15 November 2026. Target fitur tetap satu akun WhatsApp dan outbox teks MOVE; klaim di luar lingkup tersebut memerlukan implementasi dan pengujian tersendiri.

## Ruang lingkup

1. Fitur aktif adalah **pemindahan outbox JIBAS ke WAGW**.
2. Source JIBAS dipertahankan. Perubahan integrasi ditempatkan dalam `deployment/`, konfigurasi lokal, dan objek database tambahan. Perubahan WAGW dibatasi pada pemuatan driver sesuai kebutuhan, satu scheduler outbox saat reconnect, dan penggunaan ulang DB sehat pada reconnect. Pengaman deployment ditempatkan pada launcher; tidak menambah fitur inbox atau multi-account.
3. Sinkronisasi inbox, penghapusan inbox dua arah, dan penambahan komunikasi eksternal di luar pesan antrean bukan bagian dari implementasi outbox ini.
4. Instalasi ini menggunakan `wagw` dan `jbssms` pada instance MySQL/MariaDB yang sama. Kredensial tidak ditulis dalam dokumentasi atau Git.

## Kontrak pemindahan

| Aspek | Perilaku |
| --- | --- |
| Sumber | INSERT baru ke `jbssms.outbox` setelah trigger capture terpasang |
| Capture | Trigger mencatat ID sumber, nomor, teks, multipart, dan jadwal ke `wagw.bridge_outgoing` |
| Jadwal | Sumber tetap di JIBAS sampai waktunya tiba; `NULL`/zero date dianggap tanpa penundaan |
| Data saat transfer | Worker membaca dan mengunci sumber terbaru, kemudian mengunci job |
| Transaksi | INSERT `wagw.outbox`, UPDATE referensi job, DELETE sumber JIBAS, lalu COMMIT |
| Kegagalan transaksi | ROLLBACK semua langkah; sumber tetap ada dan tidak terbentuk tujuan baru yang committed |
| Riwayat | `jbssms.outboxhistory` tidak dihapus atau dipalsukan statusnya |
| Sumber hilang | Job `cancelled`, tanpa mengirim salinan capture yang sudah kedaluwarsa |
| Validasi gagal | Job `rejected` beserta alasan; sumber tidak dihapus |
| Koreksi sumber | UPDATE pada sumber pending/rejected memperbarui capture dan mengembalikannya ke pending |
| Kirim ulang JIBAS | ID sumber baru diperlakukan sebagai pesan baru yang memang diminta |

Move selesai ketika pesan sudah berada pada antrean WAGW, bukan ketika diterima HP. Jadwal dipenuhi sebagai waktu paling awal transfer, bukan jaminan waktu kirim tepat; polling bridge dan scheduler gateway menambah jeda.

## Validasi

- Nomor `08…`/`8…` dinormalisasi menjadi `628…`; format akhir harus 8–15 digit.
- Teks tidak boleh kosong dan maksimum 2000 karakter sesuai pemeriksaan bridge.
- Multipart/PDU tidak diproses otomatis.
- Awalan `POLLVOTE!`, `TEXTWITHBUTTON!`, dan `[REQ_ONLINE]` ditolak untuk mencegah teks SMS dianggap perintah gateway.
- Normalisasi tidak membuktikan nomor terdaftar atau dapat dihubungi di WhatsApp.

## Status

| Status bridge | Makna |
| --- | --- |
| `pending` | Menunggu jadwal/pemrosesan; sumber belum dipindahkan |
| `queued` | Move committed; sumber dihapus dan ID antrean WAGW tercatat |
| `sent` | WAGW mencatat hasil pengiriman library sebagai sent |
| `failed` | WAGW mencatat hasil selain sent |
| `rejected` | Validasi gagal; sumber tetap tersedia |
| `cancelled` | Sumber tidak ditemukan saat diambil; tidak dikirim |

Tidak ada retry jaringan otomatis maupun penerjemahan `sent` menjadi delivery report SMS. Kegagalan setelah transfer tidak mengembalikan pesan ke JIBAS secara otomatis.

## Integritas dan konkurensi

- Ketiga tabel perpindahan harus InnoDB; worker menolak engine lain.
- Hanya satu worker bridge memegang named lock `wagw-jibas-bridge` pada instance database tersebut.
- Transaksi dan referensi ID mencegah enqueue berulang untuk satu job oleh worker. Ini **bukan** jaminan exactly-once pengiriman jaringan pada gateway asli.
- Consumer SMS lama tidak boleh mengambil antrean sumber yang sama. Row lock tidak dapat membatalkan SMS yang sudah dikirim consumer lain di luar transaksi.
- ID sumber dan tujuan harus tetap stabil; jangan TRUNCATE/reset ID atau memanipulasi tabel audit ketika integrasi aktif.
- Penghapusan riwayat tidak menjadi perintah pembatalan pesan. Perubahan setelah queued tidak disinkronkan ke tujuan.
- Trigger menambah ketergantungan penulisan JIBAS terhadap schema WAGW. Melepas integrasi harus mendahului penghapusan tabel tujuan.

## Deployment dan data sensitif

Installer Linux otomatis mendukung `install.sh --port 3000 --user admin --pass somepassword`. Parameter port adalah port publik HTTPS, user/pass adalah autentikasi dashboard pada Nginx, bukan akun database. Backend WAGW tetap di localhost. Akses publik memerlukan login dan TLS; sertifikat awal self-signed harus diverifikasi fingerprint-nya. Kredensial dashboard disimpan sebagai hash bcrypt di `/etc/wagw`, tidak dalam source/config WAGW. Opsi `--pass-file` menghindari password pada argumen/history.

Mode MOVE diaktifkan default oleh installer baru; menjalankan perintah instalasi berarti menginstruksikan aktivasi. Consumer SMS lama harus sudah dihentikan. `--no-activate-move` memasang dalam keadaan paused untuk staging. Reinstall mempertahankan kredensial DB dan sesi; perubahan username memerlukan password yang diberikan eksplisit. Installer tidak menghentikan layanan aktif secara otomatis atau membuat database JIBAS.

- Bootstrap tidak mengimpor ulang schema asli ke database yang sudah memiliki tabel; instalasi baru mengekstrak CREATE TABLE tanpa menjalankan DROP. Migrasi `sent.status` hanya memperlebar VARCHAR kurang dari 20 karakter agar nilai failed dapat disimpan. SQL dump asli tetap mengandung DROP TABLE dan tidak boleh dieksekusi manual pada data aktif.
- Runtime, dependency, konfigurasi, sesi, dan data produksi tidak dipublikasikan lewat Git.
- Startup memerlukan hak Administrator dan verifikasi reboot; keberadaan skrip installer bukan bukti startup sudah terpasang.
- Task Scheduler tidak menyimpan password database sebagai argumen; gateway/bridge membacanya dari konfigurasi lokal.
- Sesi WhatsApp valid digunakan kembali; QR diperlukan jika belum tertaut atau sesi tidak berlaku.
- Jangan mengirim pesan nyata untuk pengujian tanpa tujuan yang diizinkan. Pengujian regresi menggunakan rollback/tabel sementara.

## Kriteria penerimaan

1. Pesan due valid menghasilkan satu tujuan dan sumber terhapus dalam transaksi yang sama.
2. Simulasi kegagalan DELETE membatalkan tujuan dan perubahan receipt; sumber tetap ada.
3. Pengulangan polling tidak menambah antrean untuk job yang sudah queued.
4. Pesan terjadwal tetap berada di sumber sebelum waktunya.
5. Sumber tidak valid tetap tersedia dengan alasan penolakan.
6. Sumber yang sudah hilang tidak menghasilkan pengiriman dari snapshot.
7. Status WAGW dapat direkonsiliasi ke job tanpa memalsukan status SMS JIBAS.
8. Inbox tetap nonaktif dan source JIBAS tidak diubah. Perubahan WAGW terbatas pada pemuatan driver dan pengaman reconnect/scheduler yang dijelaskan di atas.

Pengaman VPS: launcher menolak startup sebelum DB/schema siap, mengambil named lock gateway, membatasi backend dashboard ke loopback, dan keluar ketika guard koneksi database hilang. Nginx menyediakan endpoint IP:PORT dengan HTTPS/login; systemd/Windows supervisor memulihkan proses. Proteksi singleton ini hanya berlaku untuk instance yang menggunakan launcher; menjalankan wabot.js langsung melewatinya.

Penerimaan produksi tetap memerlukan pengujian pada OS/VPS tujuan, startup ulang/reboot, cutover consumer lama, pairing, dan penerimaan pesan ke nomor tester yang disetujui. Laporan audit Windows tidak menggantikan pengujian Linux.

Pemuatan driver: MySQL hanya memuat mysql2, Oracle hanya oracledb, SQL Server hanya mssql, SQLite memuat sqlite/sqlite3, ODBC hanya odbc. Tes koneksi menggunakan driver yang dipilih pada request tanpa mengganti pilihan database aktif. Driver yang pernah dimuat tetap berada di cache sampai restart. `deployment/test-db-loading.js` memverifikasi seluruh jalur memakai mock, termasuk kondisi driver lain tidak tersedia.

Kriteria transaksi di atas telah diuji melalui `deployment/test-bridge.js`. Mode move diuji tanpa kiriman eksternal baru. Uji WhatsApp langsung pada tahap sebelumnya membuktikan jalur gateway, tetapi tidak menggantikan uji reboot atau validasi seluruh fitur JIBAS.

## Penghentian dan rollback

Jeda bridge dengan `enabled=0`; pesan yang sudah di WAGW tetap dapat dikirim. Periksa antrean, hentikan supervisor, dan lepaskan trigger `jbssms.wagw_capture_outbox` serta `jbssms.wagw_update_outbox` sebelum menghapus schema integrasi. Pertahankan audit serta riwayat asli. Pengembalian pesan yang sudah dipindahkan membutuhkan rekonsiliasi manual berdasarkan ID/status agar tidak mengirim ulang pesan yang sudah terkirim.

## Kontrak publikasi Git

- Repository tujuan harus terverifikasi pada akun yang diminta. Jangan menganggap repo berstatus 404 sebagai izin membuat repo pengganti.
- Publikasikan source, dokumentasi, schema, lockfile, dan contoh konfigurasi saja. Konfigurasi aktual, PAT, sesi autentikasi WhatsApp, database, log, PID, backup, serta hasil deployment lokal tidak ikut commit.
- Token tidak boleh dimasukkan dalam URL remote, argumen Git, dokumentasi, maupun konfigurasi Git permanen.
- Push dilakukan tanpa force. Jika riwayat remote berbeda, inspeksi dan rekonsiliasi diperlukan; jangan menghapus commit remote atau mengubah visibility secara otomatis.
- Publikasi repository tidak merupakan izin menjalankan installer terhadap VPS produksi atau mengirim pesan nyata baru.
- Commit/push hanya dinyatakan selesai sesudah hasil operasi dan commit remote dapat diverifikasi. Batas izin filesystem atau akses repository dilaporkan apa adanya.
