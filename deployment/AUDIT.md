# Audit end-to-end â€” 13 November 2026

Pembaruan 15 November: installer otomatis kini mendukung port publik dan login dashboard melalui HTTPS/Nginx (`install.sh --port 3000 --user admin --pass somepassword`). Node dipasang pada runtime terpisah; detail terbaru ada di [VPS.md](VPS.md) dan README utama. Pernyataan SSH-only/prasyarat Node manual pada audit awal di bawah merupakan catatan historis. Uji penuh instalasi/boot VPS tetap belum dinyatakan lulus.

Validasi lanjutan: [GitHub Actions Ubuntu 24.04](https://github.com/smahud/WhatsAppGateway/actions/runs/43679657986) selesai **success**. Clean npm install profil minimal, uji Node, Bash/shellcheck, penolakan CLI invalid, dan smoke test Nginx nyata (HTTPS, login, password salah, proxy terautentikasi, CSRF, redirect HTTP) semuanya lulus. Ini menggantikan keterbatasan awal mengenai tidak adanya pemeriksaan Bash/clean npm Linux; uji installer penuh, systemd boot, DB outage, dan delivery VPS tetap belum dilakukan.

## Kesimpulan

Paket deployment outbox MOVE telah diperbaiki dan diuji pada Windows + MariaDB lokal. Siap untuk **uji penerimaan staging**, belum disertifikasi siap produksi Linux karena VPS/OS tujuan belum dikonfirmasi dan tidak tersedia runtime Linux pada sesi audit. Tidak ada pesan nyata baru yang dikirim selama audit.

## Temuan dan tindakan

| Temuan | Tindakan/status |
| --- | --- |
| Installer membaca dump yang berisi DROP TABLE | Bootstrap kini hanya mengekstrak 10 CREATE TABLE IF NOT EXISTS; tidak menjalankan dump penuh |
| CREATE OR REPLACE TRIGGER khusus MariaDB | Diganti CREATE TRIGGER portabel; trigger identik dilewati, drift ditolak tanpa DROP |
| sent.status VARCHAR(5) tidak cukup untuk failed | Migrasi memperlebar ke VARCHAR(20); perubahan lokal berhasil, schema lama disimpan sebagai backup lokal |
| Dashboard tanpa auth bind ke semua interface | Launcher membatasi bind ke 127.0.0.1; localhost terverifikasi dengan listener aktual |
| Gateway bisa hidup ketika DB belum siap | Preflight sebelum WhatsApp, guard koneksi DB dan lock gateway; gagal startup dapat dipulihkan process manager |
| Beberapa gateway mengambil outbox yang sama | Lock gateway mencegah instance kedua melalui launcher; startup instance kedua diuji gagal sebelum membuka sesi |
| Sesi koneksi ulang menambah scheduler | Scheduler sekarang singleton; unit test memverifikasi tiga pemanggilan hanya membuat satu timer |
| DB diinisialisasi ulang tiap reconnect WA | Koneksi sehat digunakan ulang saat startSession; config DB tetap bisa diinisialisasi dari API |
| Offset jadwal mengikuti timezone server VPS | SQL session dan driver disamakan ke offset konfigurasi, default +07:00 |
| Driver non-MySQL dipasang sebagai mandatory | Dipindah ke optionalDependencies; profil Linux --omit=optional hanya memasang kebutuhan utama outbox teks |
| Bootstrap tidak ditunggu secara eksplisit | Setup sekarang diekspor dan di-await; failure menghasilkan exit nonzero |
| Antrean sumber lama tidak memiliki capture | Preflight menolak aktivasi, tidak diam-diam melewatkan atau memutar ulang |
| Startup hanya tersedia untuk Windows | Disediakan dua unit systemd dan installer Linux; belum dieksekusi pada Linux |
| Paket transfer dapat berisi auth/data produksi | Builder whitelist source; config, sesi, DB, PID, log, node.exe dan node_modules dikecualikan |

## Bukti verifikasi

- `test-db-loading.js`: lima jalur init/tes DB, driver lain tidak tersedia, pergantian DB, dan singleton scheduler lulus dengan mock.
- `test-bridge.js`: trigger asli dalam rollback, move terisolasi, jadwal, penolakan, sumber hilang, kegagalan DELETE, rollback destination/receipt, retry enqueue, dan status lulus. Tidak ada pesan eksternal.
- `test-deployment.js`: ekstraksi schema aman, trigger idempoten/portabel, drift ditolak, port konfigurasi, bind loopback, dan driver tidak terpakai tidak dimuat lulus.
- Bootstrap lokal dijalankan ulang dua kali tanpa DROP tabel atau perubahan data JIBAS.
- `doctor.js`: database siap, timezone +07:00, worker aktif, mode move, inbox nonaktif.
- Gateway dan bridge direstart oleh supervisor; WA dan DB kembali connected tanpa pairing ulang.
- Instance gateway kedua ditolak oleh named lock; listener aktual 127.0.0.1:3000.
- Lockfile dihasilkan ulang offline; npm ci dry-run dengan profil minimal lulus. Ini bukan pengganti clean install Linux.

## Batas verifikasi / acceptance gate

Belum diuji: instalasi bersih npm di Linux, shell syntax oleh Bash Linux, unit systemd saat boot, user/permission Linux, DB outage pada server staging, remote DB/TLS, pemulihan backup, delivery mode move pada VPS, dan audit CVE online dependency. Git Bash di sesi Windows tidak dapat berjalan karena akses OS; WSL Linux juga tidak tersedia. Tidak ada kesimpulan Linux-ready berdasarkan pemeriksaan Windows saja.

Sebelum produksi, jalankan checklist [VPS.md](VPS.md), pastikan consumer lama berhenti dan identifikasi topology database. Pada mesin lokal konfigurasi masih memakai root DB; contoh produksi menggunakan akun khusus. Versi gateway memakai Baileys pihak ketiga; ada celah crash antara send dan pencatatan hasil serta tidak ada jaminan exactly-once delivery.

## Batas perubahan source

Source JIBAS tidak diubah. WAGW hanya berubah untuk lazy-loading driver, menjaga satu scheduler, dan menghindari inisialisasi DB berulang pada reconnect ketika koneksi masih sehat. Pengaman VPS, instalasi, dan pemeriksaan ditempatkan di deployment. Inbox tetap di luar scope.

