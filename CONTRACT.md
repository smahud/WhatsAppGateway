# Kontrak Integrasi JIBAS WhatsApp Gateway

Dokumen ini menetapkan perilaku teknis integrasi yang disepakati pada proyek ini. Ini bukan kontrak hukum atau pemberian lisensi atas source asli.

Target fitur adalah satu akun WhatsApp dan outbox teks MOVE; fitur di luar lingkup ini memerlukan implementasi dan pengujian tersendiri.

## Ruang lingkup

1. Fitur aktif dan default proyek adalah **pengganti pengiriman SMS keluar JIBAS melalui WhatsApp**, menggunakan MOVE outbox.
2. Source JIBAS dipertahankan. Integrasi berada di `deployment/`, konfigurasi lokal, dan objek database tambahan. Setiap launcher normal membutuhkan schema dan trigger JIBAS. Tidak ada mode instalasi tanpa JIBAS, sinkronisasi inbox JIBAS, atau dukungan multi-account.
3. Sinkronisasi inbox, penghapusan inbox dua arah, dan penambahan komunikasi eksternal di luar pesan antrean bukan bagian dari implementasi outbox ini.
4. Database gateway (`jibas_wg` untuk pemasangan baru, `wagw` sebagai schema kompatibilitas) dan `jbssms` berada pada satu instance MySQL/MariaDB. Kredensial tidak ditulis dalam dokumentasi atau Git.

## Kontrak pemindahan

| Aspek | Perilaku |
| --- | --- |
| Sumber | INSERT baru ke `jbssms.outbox` setelah trigger capture terpasang |
| Capture | Trigger mencatat ID sumber, nomor, teks, multipart, dan jadwal ke `bridge_outgoing` pada schema gateway |
| Jadwal | Sumber tetap di JIBAS sampai waktunya tiba; `NULL`/zero date dianggap tanpa penundaan |
| Data saat transfer | Worker membaca dan mengunci sumber terbaru, kemudian mengunci job |
| Transaksi | INSERT `outbox` gateway, UPDATE referensi job, DELETE sumber JIBAS, lalu COMMIT |
| Kegagalan transaksi | ROLLBACK semua langkah; sumber tetap ada dan tidak terbentuk tujuan baru yang committed |
| Riwayat | `jbssms.outboxhistory` tidak dihapus atau dipalsukan statusnya |
| Sumber hilang | Job `cancelled`, tanpa mengirim salinan capture yang sudah kedaluwarsa |
| Validasi gagal | Job `rejected` beserta alasan; sumber tidak dihapus |
| Koreksi sumber | UPDATE pada sumber pending/rejected memperbarui capture dan mengembalikannya ke pending |
| Kirim ulang JIBAS | ID sumber baru diperlakukan sebagai pesan baru yang memang diminta |

MOVE selesai ketika pesan berada pada antrean gateway, bukan ketika diterima HP. Jadwal menentukan waktu paling awal transfer, bukan jaminan waktu kirim tepat; polling worker dan gateway menambah jeda.

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
| `queued` | MOVE committed; sumber dihapus dan ID antrean gateway tercatat |
| `sent` | Gateway mencatat hasil pengiriman library sebagai sent |
| `failed` | Gateway mencatat hasil selain sent |
| `rejected` | Validasi gagal; sumber tetap tersedia |
| `cancelled` | Sumber tidak ditemukan saat diambil; tidak dikirim |

Tidak ada retry jaringan otomatis maupun penerjemahan `sent` menjadi delivery report SMS. Kegagalan setelah transfer tidak mengembalikan pesan ke JIBAS secara otomatis.

## Integritas dan konkurensi

- Ketiga tabel perpindahan harus InnoDB; worker menolak engine lain.
- Hanya satu worker bridge yang memegang named lock pada instance database tersebut. Nama lock lama dipertahankan untuk mencegah dua versi berjalan bersama.
- Transaksi dan referensi ID mencegah enqueue berulang. Selama proses masih hidup, kegagalan menulis hasil tidak memanggil WhatsApp lagi. Ini **bukan** jaminan exactly-once jika proses berhenti antara pengiriman dan pencatatan.
- Consumer SMS lama tidak boleh mengambil antrean sumber yang sama. Row lock tidak dapat membatalkan SMS yang sudah dikirim consumer lain di luar transaksi.
- ID sumber dan tujuan harus tetap stabil; jangan TRUNCATE/reset ID atau memanipulasi tabel audit ketika integrasi aktif.
- Penghapusan riwayat tidak menjadi perintah pembatalan pesan. Perubahan setelah queued tidak disinkronkan ke tujuan.
- Trigger menambah ketergantungan penulisan JIBAS terhadap schema gateway. Lepas integrasi sebelum menghapus tabel tujuan. Installer memeriksa konflik antara trigger baru dan trigger legacy; hanya satu pasangan boleh aktif.

## Deployment dan data sensitif

Installer membaca koneksi dan port dashboard dari `config.json`, disiapkan dari contoh. `--user` dan `--pass`/`--pass-file` mengatur login dashboard, bukan akun database. Batas akses: Windows lokal, Linux HTTPS melalui Nginx, backend tetap loopback. Pengguna membuka `/login` sebelum dashboard. Kredensial baru di-hash scrypt; bcrypt Linux lama dapat dimigrasikan tanpa mengetahui password aslinya. Instalasi pertama tanpa argumen membuat admin dengan password acak; repair tanpa argumen tidak me-rotate login.

`deploy.js` dan installer memasang integrasi JIBAS dan mengaktifkan MOVE secara default. Consumer SMS lama harus sudah dihentikan. Aktivasi menolak pesan lama yang tidak dicatat trigger, tanpa replay atau penghapusan. `--no-activate-move` memasang integrasi dengan MOVE dijeda. `pause.js` tidak membatalkan pesan yang sudah masuk antrean gateway. Installer memeriksa port sebelum bootstrap: listener asing ditolak; hanya instance terverifikasi yang diperbaiki. `--credentials-only` tidak mengubah DB atau menghentikan layanan. Uninstall tidak menghapus DB JIBAS, trigger, config, login, sesi, atau antrean.

- Bootstrap tidak mengimpor ulang schema asli ke database yang sudah memiliki tabel; instalasi baru mengekstrak CREATE TABLE tanpa menjalankan DROP. Migrasi `sent.status` hanya memperlebar VARCHAR kurang dari 20 karakter agar nilai failed dapat disimpan. SQL dump asli tetap mengandung DROP TABLE dan tidak boleh dieksekusi manual pada data aktif.
- Runtime, dependency, konfigurasi, sesi, dan data produksi tidak dipublikasikan lewat Git.
- Startup memerlukan hak Administrator dan verifikasi reboot; keberadaan skrip installer bukan bukti startup sudah terpasang.
- Windows Service menggunakan akun LocalService, tidak menyimpan password database sebagai argumen, dan mewajibkan login dashboard melalui hash scrypt lokal. Startup Scheduler lama tidak dijalankan bersamaan.
- Sesi WhatsApp valid digunakan kembali; QR diperlukan jika belum tertaut atau sesi tidak berlaku.
- Jangan mengirim pesan nyata untuk pengujian tanpa tujuan yang diizinkan. Pengujian regresi menggunakan rollback/tabel sementara.

## Kriteria penerimaan

1. Pesan due valid menghasilkan satu tujuan dan sumber terhapus dalam transaksi yang sama.
2. Simulasi kegagalan DELETE membatalkan tujuan dan perubahan receipt; sumber tetap ada.
3. Pengulangan polling tidak menambah antrean untuk job yang sudah queued.
4. Pesan terjadwal tetap berada di sumber sebelum waktunya.
5. Sumber tidak valid tetap tersedia dengan alasan penolakan.
6. Sumber yang sudah hilang tidak menghasilkan pengiriman dari snapshot.
7. Status gateway dapat direkonsiliasi ke job tanpa memalsukan status SMS JIBAS.
8. Sinkronisasi inbox JIBAS tetap nonaktif dan source JIBAS tidak diubah.

Launcher `deployment/start-gateway.js` menolak startup sebelum schema/trigger JIBAS siap, mengambil named lock gateway, membatasi backend ke loopback, dan keluar ketika koneksi penjaga lock hilang. Windows menjalankan worker di proses gateway yang sama; di Linux worker adalah unit systemd bagian dari gateway. Readiness mengharuskan worker tersedia kecuali mode diagnostik yang eksplisit. Penghapusan massal Outbox/Sent via dashboard dinonaktifkan agar tidak memutus audit JIBAS.

Penerimaan produksi tetap memerlukan pengujian pada OS/VPS tujuan, startup ulang/reboot, cutover consumer lama, pairing, dan penerimaan pesan ke nomor tester yang disetujui. Laporan audit Windows tidak menggantikan pengujian Linux.

Profil JIBAS hanya memakai MySQL/MariaDB. Tes koneksi dashboard memvalidasi schema JIBAS pada target tanpa mengganti database aktif. Perubahan koneksi baru dipakai setelah restart.

Kriteria transaksi di atas telah diuji melalui `deployment/test-bridge.js`. Mode move diuji tanpa kiriman eksternal baru. Uji WhatsApp langsung pada tahap sebelumnya membuktikan jalur gateway, tetapi tidak menggantikan uji reboot atau validasi seluruh fitur JIBAS.

## Penghentian dan rollback

Jeda bridge dengan `deployment/pause.js`; pesan yang sudah di antrean gateway tetap dapat dikirim. Periksa antrean, hentikan layanan, dan lepaskan `jbssms.jibas_wg_capture_outbox` serta `jbssms.jibas_wg_update_outbox` sebelum menghapus schema integrasi. Untuk schema legacy `wagw`, nama kedua trigger diawali `wagw_`. Pertahankan audit serta riwayat asli. Pengembalian pesan yang sudah dipindahkan membutuhkan rekonsiliasi manual berdasarkan ID/status agar tidak mengirim ulang pesan yang sudah terkirim.

## Kontrak publikasi Git

- Repository tujuan harus terverifikasi pada akun yang diminta. Jangan menganggap repo berstatus 404 sebagai izin membuat repo pengganti.
- Publikasikan source, dokumentasi, schema, lockfile, dan contoh konfigurasi saja. Konfigurasi aktual, PAT, sesi autentikasi WhatsApp, database, log, PID, backup, serta hasil deployment lokal tidak ikut commit.
- Token tidak boleh dimasukkan dalam URL remote, argumen Git, dokumentasi, maupun konfigurasi Git permanen.
- Push dilakukan tanpa force. Jika riwayat remote berbeda, inspeksi dan rekonsiliasi diperlukan; jangan menghapus commit remote atau mengubah visibility secara otomatis.
- Publikasi repository tidak merupakan izin menjalankan installer terhadap VPS produksi atau mengirim pesan nyata baru.
- Commit/push hanya dinyatakan selesai sesudah hasil operasi dan commit remote dapat diverifikasi. Batas izin filesystem atau akses repository dilaporkan apa adanya.
