# Kontrak Kerja dan Integrasi JIBAS WhatsApp Gateway

Dokumen ini adalah acuan operasional untuk agen otomatis, kontributor, dan operator yang melanjutkan proyek **JIBAS WhatsApp Gateway (JIBAS WG)**. Panduan pemasangan pengguna ada di [README](README.md); dokumen ini menjelaskan batas perubahan, alur data, pengujian, dan gerbang produksi.

> Jika dokumen dan kode berbeda, jangan menebak dan jangan langsung mengubah kode. Catat perbedaannya, tentukan mana yang benar berdasarkan test/perilaku terukur, lalu perbaiki kode dan dokumen bersama-sama.

## Mulai di sini

1. Periksa keadaan repository: `git status --short --branch`, `git log -1 --oneline`, dan `git remote -v`.
2. Baca [README](README.md), dokumen ini, [OUTBOX](deployment/OUTBOX.md), [AUDIT](deployment/AUDIT.md), serta panduan OS yang relevan.
3. Tentukan jenis perubahan: dokumentasi, gateway, bridge/database, installer Windows, installer Linux, atau packaging.
4. Jangan menyentuh service, database, config, sesi, atau antrean produksi tanpa persetujuan eksplisit dari pemilik sistem.
5. Gunakan database atau VM disposable untuk semua pengujian yang menulis data.
6. Jalankan matriks verifikasi yang sesuai di [Matriks verifikasi](#matriks-verifikasi).
7. Perbarui dokumentasi bila perilaku, opsi, atau batas produk berubah.
8. Commit hanya source yang sudah ditinjau, lalu push memakai [kontrak publikasi Git](#kontrak-publikasi-git).
9. Laporkan hasil apa adanya: commit, test, CI, dan hal yang belum diuji.

## Status handoff

- Rename ke **JIBAS WhatsApp Gateway** dan audit source sudah diselesaikan di branch `main`. Schema baru memakai `jibas_wg`; instalasi lama tetap memakai `wagw` untuk menjaga antrean.
- `npm test`, fixture installer Windows, validasi port/HTTPS Linux, dan workflow GitHub Actions Ubuntu 24.04 tercatat lulus. Periksa run terbaru pada [Actions](https://github.com/smahud/WhatsAppGateway/actions/workflows/linux-installer.yml), bukan hanya komentar di dokumen.
- Cutover produksi **belum** dijalankan oleh repository ini. Service produksi dapat masih menjalankan versi lama; source terbaru di `main` bukan bukti bahwa produksi sudah diperbarui.
- Pengujian end-to-end terakhir memakai MariaDB nyata dan **socket WhatsApp tiruan**. Pairing dan pengiriman WhatsApp nyata setelah rename belum diuji ulang. Bukti pengiriman lama tidak otomatis berlaku untuk build baru.
- Jangan menjalankan installer, aktivasi MOVE, atau pengiriman nyata hanya karena CI lulus. Ikuti [gerbang produksi](#gerbang-produksi-dan-rollback).

## Tujuan dan batas produk

1. Fitur aktif dan default adalah **pengganti pengiriman SMS keluar JIBAS melalui WhatsApp** dengan MOVE outbox.
2. JIBAS adalah prasyarat. Tidak ada mode standalone, sinkronisasi inbox JIBAS, multi-account, OTA, webhook inbox, bot executor, atau pengganti SMS interaktif.
3. Source JIBAS tidak diubah. Integrasi berada di `deployment/`, `config.json` lokal, dan objek database tambahan pada instance MySQL/MariaDB yang sama.
4. Database gateway baru bernama `jibas_wg`; schema lama `wagw` dipertahankan hanya untuk upgrade. Jangan memindahkan instalasi lama ke schema baru tanpa rekonsiliasi antrean.
5. Cakupan pengiriman adalah teks keluar dari `jbssms.outbox`. Bukti `sent` berarti library melaporkan pengiriman berhasil, bukan bukti pesan diterima atau dibaca di perangkat tujuan.

## Aturan wajib

1. **Jangan membuat instalasi tanpa JIBAS.** Launcher dan installer harus menolak konfigurasi yang tidak memiliki `jbssms.outbox`, trigger, dan schema gateway yang valid.
2. **Jangan mengubah `database: "wagw"` pada instalasi lama.** Nama itu adalah identitas kompatibilitas, bukan nama aplikasi. Mengubahnya dapat membuat antrean lama tidak terlihat.
3. **Pertahankan identifier legacy yang masih diperlukan upgrade:** schema `wagw`, lock `wagw-gateway` dan `wagw-jibas-bridge`, kolom `wagw_id`, trigger `wagw_*`, path `/opt/wagw`, unit lama, serta registrasi service `wagwpro.exe`. Rename hanya untuk identitas yang terlihat pengguna dan instalasi baru.
4. **Jangan menyentuh produksi tanpa izin.** Termasuk `Install-Windows-Service.ps1`, `Uninstall-Windows-Service.ps1`, `install.sh`, `uninstall.sh`, `deploy.js`, `activate.js`, `pause.js`, restart service, perubahan trigger, dan pengiriman pesan nyata.
5. **Jangan commit data sensitif.** `config.json`, `dashboard-auth.json`, `sessions/`, `.runtime/`, `node_modules/`, database, log, PID, backup, sertifikat, password, dan PAT tidak boleh masuk Git. Gunakan `deployment/Build-Release.ps1` untuk paket source.
6. **Jangan menambah fitur di luar scope** tanpa persetujuan dan pengujian tersendiri. Jalur OTA, webhook/bot, inbox, dan pesan masuk sudah dihapus dari alur utama.
7. **Jangan menjanjikan exactly-once delivery.** Transaksi database dan referensi ID mencegah duplikasi enqueue, tetapi crash antara pengiriman jaringan dan pencatatan SQL tetap dapat menimbulkan pesan ganda atau tidak tercatat.
8. **Jangan memalsukan audit JIBAS.** Jangan menghapus `jbssms.outboxhistory`, mengubah status historis, atau melakukan replay massal untuk menutupi antrean yang belum tercatat.
9. **Jangan force push, mengganti nama repository, atau mengubah visibility** tanpa persetujuan pemilik. Riwayat remote yang berbeda harus direkonsiliasi, bukan ditimpa.
10. **Gunakan DB/VM disposable** untuk fixture. Jangan memberi akun aplikasi produksi hak `CREATE TEMPORARY TABLES` hanya untuk test.

## Peta repository

| Path | Tanggung jawab |
| --- | --- |
| `gateway.js` | Aplikasi dashboard Express, autentikasi, endpoint QR/status, dan pengiriman WhatsApp. |
| `wabot.js`, `deployment/start-wagw.js`, `deployment/supervisor.js` | Shim kompatibilitas untuk registrasi service/task lama; bukan entry point instalasi baru. |
| `deployment/linux/pause.js` | Shim kompatibilitas untuk unit Linux lama yang masih memanggil path ini. |
| `deployment/start-gateway.js` | Preflight DB/trigger, named lock, pemilihan worker, dan lifecycle proses. |
| `deployment/bridge.js` | Worker MOVE `jbssms.outbox` ke antrean gateway dan rekonsiliasi hasil. |
| `deployment/database.js` | Koneksi, validasi schema/trigger, cutover, lock, dan status bridge. |
| `deployment/settings.js` | Pembacaan `config.json`, validasi port, dan pemilihan schema baru/legacy. |
| `deployment/bridge-triggers.js` | Definisi dan pemeriksaan trigger capture/update JIBAS. |
| `deployment/deploy.js` | Bootstrap schema, migrasi `sent.status`, pemasangan trigger, dan aktivasi MOVE. |
| `deployment/move.js`, `activate.js`, `pause.js`, `doctor.js` | Kontrol MOVE, diagnosa antrean, dan aktivasi setelah cutover. |
| `deployment/dashboard-auth.js`, `dashboard-credentials.js`, `login.html` | Login form, cookie server-side, hash scrypt/bcrypt, dan rotasi kredensial. |
| `Install-Windows-Service.ps1`, `Uninstall-Windows-Service.ps1` | Entry point PowerShell untuk install dan uninstall service Windows; keduanya tersedia di ZIP source. |
| `deployment/windows/` | Installer, proteksi ACL, registrasi SCM `JIBAS_WG.exe`, migrasi, repair, dan uninstall. |
| `deployment/linux/` | Installer systemd, Nginx HTTPS, port ownership, migrasi `/opt/wagw`, service, dan uninstall. |
| `public/` | Dashboard dan aset frontend. |
| `create tables/` | Dump schema JIBAS MySQL/MariaDB. Hanya installer yang boleh mengekstrak `CREATE TABLE`; dump utuh mengandung `DROP TABLE` dan tidak boleh dijalankan manual pada data aktif. |
| `deployment/test-*.js`, `deployment/*Fixture*.ps1`, `deployment/linux/test-*.sh` | Test tanpa produksi dan fixture disposable. |
| `.github/workflows/linux-installer.yml` | Validasi Ubuntu 24.04, systemd, Nginx, migrasi, dan SQL. |

## Alur MOVE outbox

| Aspek | Perilaku |
| --- | --- |
| Sumber | INSERT baru ke `jbssms.outbox` setelah trigger capture terpasang. |
| Capture | Trigger `jibas_wg_capture_outbox` mencatat ID sumber, nomor, teks, multipart, dan jadwal ke `bridge_outgoing` pada schema gateway. |
| Update | Trigger `jibas_wg_update_outbox` memperbarui capture untuk job `pending`/`rejected`; edit setelah `queued` tidak membatalkan pesan. |
| Jadwal | Sumber tetap di JIBAS sampai waktunya tiba; `NULL`/zero date dianggap tanpa penundaan. |
| Transfer | Worker membaca dan mengunci sumber terbaru, memvalidasi, lalu dalam satu transaksi menulis `outbox` gateway, mencatat referensi job, dan menghapus baris sumber. |
| Gagal transaksi | Semua langkah di-rollback; sumber tetap ada dan tidak ada tujuan baru yang committed. |
| Riwayat | `jbssms.outboxhistory` tidak dihapus atau dipalsukan statusnya. |
| Sumber hilang | Job `cancelled`; salinan capture yang kedaluwarsa tidak dikirim. |
| Validasi gagal | Job `rejected` beserta alasan; sumber tetap tersedia. |
| Kirim ulang JIBAS | ID sumber baru diperlakukan sebagai pesan baru yang memang diminta. |

MOVE selesai ketika pesan berada di antrean gateway, bukan ketika diterima HP. Jadwal menentukan waktu paling awal transfer; polling worker dan gateway menambah jeda.

## Validasi dan status

- Nomor `08…`/`8…` dinormalisasi menjadi `628…`; format akhir harus 8–15 digit.
- Teks tidak boleh kosong dan maksimum 2000 karakter sesuai pemeriksaan bridge.
- Multipart/PDU tidak diproses otomatis.
- Awalan `POLLVOTE!`, `TEXTWITHBUTTON!`, dan `[REQ_ONLINE]` ditolak agar teks SMS tidak dianggap perintah gateway.
- Normalisasi tidak membuktikan nomor terdaftar atau dapat dihubungi di WhatsApp.

| Status bridge | Makna |
| --- | --- |
| `pending` | Menunggu jadwal/pemrosesan; sumber belum dipindahkan. |
| `queued` | MOVE committed; sumber dihapus dan ID antrean gateway tercatat di `wagw_id`. |
| `sent` | Gateway mencatat hasil pengiriman library sebagai sent. |
| `failed` | Gateway mencatat hasil selain sent. |
| `rejected` | Validasi gagal; sumber tetap tersedia. |
| `cancelled` | Sumber tidak ditemukan saat diambil; tidak dikirim. |

Tidak ada retry jaringan otomatis maupun penerjemahan `sent` menjadi delivery report SMS. Kegagalan setelah transfer tidak mengembalikan pesan ke JIBAS secara otomatis.

## Integritas dan konkurensi

- Tabel `outbox`, `sent`, `bridge_control`, dan `bridge_outgoing` harus InnoDB; worker menolak engine lain.
- Hanya satu worker bridge yang memegang named lock `wagw-jibas-bridge` pada instance database tersebut. Gateway memegang `wagw-gateway`. Nama lock lama dipertahankan agar versi baru dan lama tidak berjalan bersamaan.
- Transaksi dan referensi ID mencegah enqueue berulang. Selama proses masih hidup, kegagalan menulis hasil tidak memanggil WhatsApp lagi.
- Consumer SMS lama tidak boleh mengambil antrean sumber yang sama. Row lock tidak dapat membatalkan SMS yang sudah dikirim consumer lain di luar transaksi.
- ID sumber dan tujuan harus tetap stabil; jangan TRUNCATE/reset ID atau memanipulasi tabel audit ketika integrasi aktif.
- Trigger menambah ketergantungan penulisan JIBAS terhadap schema gateway. Lepas integrasi sebelum menghapus tabel tujuan. Installer memeriksa konflik trigger baru dan legacy; hanya satu pasangan boleh aktif.
- Uninstall tidak melepas trigger atau mengembalikan pesan yang sudah dipindahkan. Rollback memerlukan tindakan eksplisit dan rekonsiliasi manual.

## Instalasi, login, dan data

Installer membaca koneksi dan port dashboard dari `config.json`, yang disiapkan dari `config.example.json`. Opsi `-User` dan `-Pass`/`-PassFile` (Windows) atau `--user` dan `--pass`/`--pass-file` (Linux) mengatur login dashboard, bukan akun database.

| Opsi login | Instalasi baru | Instalasi yang sudah ada |
| --- | --- | --- |
| Tidak ada | `admin` + password acak, dicetak sekali | Pertahankan username/password tersimpan |
| Username saja | NAMA + password acak | Ganti username dan buat password acak baru |
| Password saja, langsung atau lewat file | `admin` + password pilihan | Pertahankan username; ganti password |
| Username dan password | Gunakan keduanya | Ganti keduanya |

- `-PassFile` (Windows) atau `--pass-file` (Linux) memakai file privat UTF-8 satu baris untuk menghindari password di shell history.
- Login melalui halaman `/login` dan cookie server-side, bukan Basic Auth browser. Pengguna Linux lama dengan Nginx bcrypt dimigrasikan saat repair.
- Mengganti login memutus sesi dashboard lama, bukan sesi WhatsApp.
- `-CredentialsOnly` (Windows) atau `--credentials-only` (Linux) tidak mengubah database dan tidak me-restart service.
- Windows: dashboard hanya loopback; installer memproteksi ACL folder dan menjalankan service `JIBAS_WG.exe` sebagai `LocalService`.
- Linux: dashboard HTTPS melalui Nginx; backend tetap loopback. Runtime berada di `/opt/jibas-wg-runtime`, aplikasi di `/opt/jibas-wg`, dan state TLS di `/etc/jibas-wg`.
- Port dashboard diperiksa sebelum bootstrap. Listener asing ditolak; listener milik instalasi gateway yang terverifikasi boleh diperbaiki.
- Instalasi normal memasang trigger dan mengaktifkan MOVE. Gunakan `-NoActivateMove` (Windows) atau `--no-activate-move` (Linux) untuk staging.
- Installer tidak menghapus pesan, tidak memutar ulang antrean lama, dan tidak membuat database JIBAS dari nol.
- Uninstall mempertahankan database, config, login, sesi WhatsApp, antrean, dan trigger JIBAS.

## Matriks verifikasi

| Tujuan | Perintah | Prasyarat |
| --- | --- | --- |
| Unit/static tanpa DB atau WhatsApp | `npm test` | Node 22.14–24 dan dependensi dari lockfile. |
| Transaksi bridge dan validasi | `node deployment/test-bridge.js` | DB MySQL/MariaDB disposable yang sudah di-deploy; tidak mengirim WhatsApp. |
| Trigger → worker → gateway | `node deployment/test-jibas-e2e.js` | DB disposable dengan marker fixture, tabel kosong, config, dan login dashboard; socket WhatsApp tiruan. |
| Fixture installer Windows | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Test-Windows-Fixture.ps1 -MariaDbBin PATH -TempRoot PATH` | Binari MariaDB yang sudah diunduh; tidak menyentuh produksi. |
| Service Windows pada fixture | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Test-Windows-Service.ps1 -FixtureConfig PATH` | Konfigurasi fixture disposable. |
| Keputusan port Linux | `bash deployment/linux/test-ports.sh` | Bash dan `ss`; memakai mock listener. |
| HTTPS/login/CSRF Linux | `sudo env PATH="$PATH" bash deployment/linux/test-nginx.sh` | Runner Linux disposable, Nginx, OpenSSL, apache2-utils, dependensi Node. |
| Installer Linux penuh | `sudo env PATH="$PATH" GITHUB_ACTIONS=true JIBAS_WG_CI_DB_PASSWORD=... bash deployment/linux/test-systemd.sh` | Hanya runner GitHub Actions disposable dengan MariaDB fixture. |
| Audit dependensi | `npm audit --omit=dev` | Akses registry; laporkan hasil dan lockfile yang dipakai. |
| Sintaks shell | `bash -n install.sh uninstall.sh deployment/linux/*.sh` dan `shellcheck --severity=error ...` | Bash dan shellcheck. |
| Paket source | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Build-Release.ps1` | Tidak menyertakan config, sesi, runtime, log, atau PAT. |
| Pemeriksaan publikasi | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Publish-GitHub.ps1 -CheckOnly -AllowPublic` | PAT pemilik repository dan akses jaringan. |

`npm test` tidak menyentuh DB atau WhatsApp. `test-jibas-e2e.js` memakai trigger/worker/gateway asli, tetapi socket WhatsApp tiruan; lulusnya test ini bukan bukti pairing, pengiriman, atau penerimaan di HP.

## Definisi selesai

Sebuah perubahan baru boleh dianggap selesai bila:

1. Perilaku yang diubah sesuai [aturan wajib](#aturan-wajib) dan tidak keluar dari scope.
2. Test yang relevan di [matriks verifikasi](#matriks-verifikasi) dijalankan dan hasilnya dicatat.
3. Dokumentasi diperbarui bila opsi, path, status, atau batas berubah.
4. Tidak ada secret, config produksi, sesi, database, log, atau artefak runtime di diff/commit.
5. `git diff --check` bersih dan `git status` hanya berisi perubahan yang disengaja.
6. Commit dibuat dengan pesan yang menjelaskan perubahan, lalu di-push tanpa force.
7. Commit remote dan hasil CI diverifikasi setelah push.
8. Tindakan produksi yang belum dijalankan disebutkan secara eksplisit dalam laporan.

## Gerbang produksi dan rollback

Cutover produksi adalah tindakan operator, bukan bagian dari CI. Jangan mengaktifkan MOVE pada produksi sebelum seluruh langkah berikut selesai:

1. Cadangkan database JIBAS, database gateway, `config.json`, `dashboard-auth.json`, dan `sessions/`. Catat commit/service yang sedang berjalan.
2. Hentikan consumer SMS lama. Pastikan tidak ada proses lain yang mengambil `jbssms.outbox`.
3. Jalankan `deployment/doctor.js`. Untuk instalasi baru, gunakan runtime Node yang sesuai; `uncaptured` harus `0` dan `cutoverReady` harus `true`.
4. Jika `uncaptured` bukan nol, **jangan** replay atau hapus massal. Tinjau pesan bersama operator JIBAS dan rekonsiliasi secara manual.
5. Untuk staging, pasang dengan `-NoActivateMove` (Windows) atau `--no-activate-move` (Linux), periksa `bridge_outgoing`, lalu aktifkan dengan `deployment/activate.js` setelah antrean bersih.
6. Restart/reboot service, periksa login, `/healthz`, worker, MOVE, dan status WhatsApp.
7. Kirim **satu pesan teks dari menu SMS JIBAS** ke nomor tester yang disetujui. Konfirmasi penerimaan di perangkat tujuan; jangan memakai tombol uji langsung dashboard sebagai bukti alur JIBAS.
8. Pantau Outbox, Sent, dan `bridge_outgoing`. Hentikan cutover bila ada duplikasi, penolakan tak terduga, atau worker tidak siap.

Verifikasi minimal:

```powershell
# Windows: gunakan node.exe portable/runtime jika tersedia.
Invoke-RestMethod http://127.0.0.1:3000/healthz
Get-Service -Name JIBAS_WG.exe
```

```bash
# Linux: ganti path/port sesuai instalasi.
systemctl status jibas-wg-gateway.service jibas-wg-bridge.service
sudo journalctl -u jibas-wg-gateway -u jibas-wg-bridge -n 60 --no-pager
curl --fail http://127.0.0.1:BACKEND_PORT/healthz
curl -k -I https://127.0.0.1:3000/
```

`/healthz` melaporkan `pid`, `dbConnected`, dan `jibasReady`; endpoint ini tidak boleh membocorkan QR atau isi pesan dan tidak diekspos sebagai endpoint publik di Linux.

## Penghentian dan rollback

Jeda transfer baru dengan `deployment/pause.js`; pesan yang sudah berada di antrean gateway tetap dapat dikirim. Periksa antrean, hentikan layanan, dan lepaskan trigger `jbssms.jibas_wg_capture_outbox` serta `jbssms.jibas_wg_update_outbox` sebelum menghapus schema integrasi. Untuk schema legacy `wagw`, nama trigger diawali `wagw_`.

Pertahankan `jbssms.outboxhistory`, audit, dan riwayat asli. Pengembalian pesan yang sudah dipindahkan membutuhkan rekonsiliasi manual berdasarkan ID/status agar tidak mengirim ulang pesan yang sudah terkirim. Uninstaller tidak melepas trigger dan tidak menghapus data; rollback bukan operasi satu perintah.

## Kontrak publikasi Git

- Repository tujuan adalah `https://github.com/smahud/WhatsAppGateway.git` pada akun `smahud`; jangan mengganti nama atau visibility tanpa izin.
- Publikasikan source, dokumentasi, schema, lockfile, dan contoh konfigurasi saja. Konfigurasi aktual, PAT, sesi WhatsApp, database, log, PID, backup, dan hasil deployment lokal tidak ikut commit.
- Token tidak boleh dimasukkan dalam URL remote, argumen Git, dokumentasi, atau konfigurasi Git permanen. Gunakan `github.pat.txt` yang di-ignore atau environment yang aman.
- Jalankan `deployment/Publish-GitHub.ps1 -AllowPublic` untuk publikasi. Script memverifikasi pemilik PAT, hak tulis, URL origin, fast-forward, dan memindai path/isi commit untuk kredensial sebelum push.
- Gunakan `-CheckOnly` untuk memeriksa tanpa push. Push tanpa force; jika remote bukan ancestor, inspeksi dan rekonsiliasi, jangan menimpa commit remote.
- Publikasi repository bukan izin menjalankan installer pada VPS produksi atau mengirim pesan nyata baru.
- Commit/push hanya dinyatakan selesai setelah commit remote dan hasil CI diverifikasi. Batas izin filesystem atau akses repository dilaporkan apa adanya.

## Format laporan handoff

Sertakan minimal:

```text
Perubahan:
File:
Uji yang dijalankan:
Hasil uji:
Commit:
Status CI:
Risiko/batas yang tersisa:
Tindakan produksi yang belum dilakukan:
```
