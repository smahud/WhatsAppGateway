# Analisis Sistem, Riwayat Bug, dan Panduan Migrasi PowerShell
## JIBAS WhatsApp Gateway (JIBAS WG)

> **Catatan Dokumen**: Dokumen ini disusun khusus sebagai hasil analisis mendalam repository, arsitektur sistem, riwayat commit Git, log runtime, serta evaluasi proses instalasi di Linux dan Windows. Dokumen ini ditujukan sebagai **panduan kerja teknis bagi agent berikutnya** yang bertugas melakukan perbaikan (fix), patching, dan migrasi script instalasi Windows dari `.bat` ke `.ps1`.

---

## 1. Ringkasan Eksekutif & Status Repository

- **Nama Proyek**: JIBAS WhatsApp Gateway (JIBAS WG)
- **Versi Proyek**: `1.1.0` (merujuk pada `package.json`)
- **Tujuan Utama**: Menggantikan pengiriman SMS keluar pada aplikasi Sistem Informasi Sekolah **JIBAS** (`jbssms.outbox`) secara transaksional ke WhatsApp menggunakan library `@whiskeysockets/baileys`.
- **Status Repository saat Analisis**:
  - Branch aktif: `main`
  - Status Git: Clean working tree (semua file telah terindeks dengan baik).
  - Validasi test bawaan (`npm test`): **PASS** (mencakup db-loading, deployment invariants, dashboard-auth, dashboard-ui, dan linux-install).
  - Catatan Pemulihan: Direktori `.git` sebelumnya sempat terhapus ke Recycle Bin (`C:\$Recycle.Bin\...`) dan telah berhasil dipulihkan secara utuh ke root repository sehingga riwayat commit dan integritas Git kembali normal.

---

## 2. Arsitektur Keseluruhan Repository

Sistem JIBAS WG dibangun dengan pendekatan non-intrusif (tidak mengubah source code aplikasi JIBAS). Integrasi berjalan di layer database MySQL/MariaDB pada instance yang sama.

```
                          +-------------------------+
                          |      Aplikasi JIBAS     |
                          +-------------------------+
                                       |
                         (INSERT)      |
                                       v
                          +-------------------------+
                          |      jbssms.outbox      |
                          +-------------------------+
                                       |
                 (Trigger DB)          |
            jibas_wg_capture_outbox    |
                                       v
                          +-------------------------+
                          |   jibas_wg.bridge_out   |
                          +-------------------------+
                                       |
                                       | (Worker MOVE - transactional)
                                       v
                          +-------------------------+
                          |     jibas_wg.outbox     |
                          +-------------------------+
                                       |
                                       | (Polling / Baileys)
                                       v
                          +-------------------------+
                          |    WhatsApp Web API     |
                          |  (@whiskeysockets)      |
                          +-------------------------+
                                       |
                                       v
                          +-------------------------+
                          |      jibas_wg.sent      |
                          +-------------------------+
```

### Komponen Kunci Repository:
1. **`gateway.js`**:
   - Server web Express yang menyediakan antarmuka Dashboard interaktif, endpoint QR code pairing, endpoint status kesehatan (`/healthz`), dan pengontrol sesi Baileys WhatsApp.
   - Menghubungkan pooling database (MySQL/MariaDB) dan memproses antrean pesan keluar (`processOutbox`).
2. **`wabot.js`**:
   - Berfungsi sebagai shim backwards-compatibility untuk service Windows/Linux lama yang masih menunjuk file entry `wabot.js`. File ini mengimpor dan menjalankan `gateway.js`.
3. **`deployment/start-gateway.js`**:
   - Supervisor proses gateway. Bertugas memeriksa preflight database, mengunci named lock MySQL (`wagw-gateway`), memastikan migrasi cutover siap (`assertCutover`), dan menjalankan background bridge worker (`deployment/bridge.js`).
4. **`deployment/bridge.js` & `deployment/database.js`**:
   - Bridge worker yang menjalankan transaksi MOVE: mengunci baris di `jbssms.outbox`, memvalidasi nomor telepon dan teks, menulis ke `jibas_wg.outbox`, mencatat status ke `bridge_outgoing`, dan menghapus baris dari `jbssms.outbox` secara atomik.
   - Named locks yang digunakan: `wagw-gateway` dan `wagw-jibas-bridge` (nama lock legacy sengaja dipertahankan agar instance lama dan baru tidak berjalan bersamaan).
5. **`deployment/dashboard-auth.js` & `dashboard-credentials.js`**:
   - Manajemen autentikasi berbasis sesi cookie HTTP-only (bukan browser basic-auth).
   - Mendukung verifikasi kata sandi dengan algoritma `scrypt` serta migrasi otomatis dari format lama `bcrypt` (Apache htpasswd). Dilengkapi proteksi CSRF, origin validation, dan sanitasi kredensial.
6. **`deployment/windows/`**:
   - Arsitektur service Windows menggunakan pembungkus WinSW (`JIBAS_WG.exe`).
   - Service dijalankan di bawah akun terbatas `NT AUTHORITY\LocalService` (bukan SYSTEM atau User desktop).
   - Pengerasan izin file menggunakan ACL Windows (`icacls`) agar akun LocalService memiliki hak baca-eksekusi pada kode dan tulis hanya pada `sessions/`, `config.json`, dan `daemon/logs/`.
7. **`deployment/linux/`**:
   - Konfigurasi systemd dual-unit: `jibas-wg-gateway.service` dan `jibas-wg-bridge.service`.
   - Menggunakan akun sistem terisolasi `jibas-wg` dengan runtime Node.js privat di `/opt/jibas-wg-runtime`.
   - Reverse proxy menggunakan Nginx dengan HTTPS lokal (sertifikat TLS self-signed) dan backend loopback terproteksi.
8. **`public/`**:
   - Antarmuka web pengguna (HTML/CSS/JS native) dengan fitur auto-refresh QR Code pairing dan pemantauan status koneksi secara real-time.

---

## 3. Analisis Riwayat Commit & Kronologi Bug yang Pernah Terjadi

Berdasarkan penelusuran riwayat 11 commit Git dari awal hingga terkini, berikut adalah kronologi masalah teknis, bug, dan solusi yang telah diterapkan:

| Hash Commit | Judul & Rangkuman | Bug / Masalah yang Dihadapi | Solusi / Perbaikan yang Dilakukan |
| :--- | :--- | :--- | :--- |
| **`5941e20`** | *Initialize WhatsAppGateway deployment documentation* | Inisiasi awal repositori dan kontrak deployment. | Dokumentasi awal arsitektur dan persyaratan sistem. |
| **`e20a79b`** | *Add WAGW JIBAS outbox move integration and VPS deployment* | Pengambilan pesan SMS JIBAS rawan duplikasi jika hanya mengandalkan polling tabel biasa; ketergantungan driver DB yang kaku. | Membuat trigger database `AFTER INSERT` & `AFTER UPDATE` pada `jbssms.outbox`. Menerapkan mekanisme MOVE atomik (dalam 1 transaksi SQL). Driver DB dimuat secara lazy (mysql2). Menambahkan named lock DB. |
| **`3a21d0a`** | *Add automatic Linux installer with port and dashboard login* | Instalasi Linux manual rentan salah konfigurasi port, konflik akun root, dan tidak aman bila dashboard HTTP diekspos langsung. | Dibuat `install.sh` otomatis berbasis Ubuntu/Debian: mengunduh runtime Node privat, memasang Nginx reverse proxy dengan HTTPS, memisahkan backend ke port privat loopback, dan integrasi systemd. |
| **`37037a7`** | *Expose Linux installer validation result as commit status* | Pengujian CI di GitHub Actions belum melaporkan status commit otomatis. | Penambahan workflow reporting status commit pada GitHub Actions runner. |
| **`6f4b90a`** | *Document installer command and successful Ubuntu HTTPS login checks* | Dokumentasi opsi login CLI Linux kurang jelas. | Memperbarui README terkait panduan login dan verifikasi HTTPS di Ubuntu. |
| **`2ecb308`** | *Preserve UTF-8 encoding in deployment documentation* | Terjadi kerusakan karakter (mojibake / encoding mismatch) pada dokumen markdown saat dibuka di Windows/Linux. | Memastikan penyimpanan file dokumentasi menggunakan UTF-8 tanpa BOM. |
| **`942221e`** | *Rename to JIBAS WhatsApp Gateway and harden deployment* *(Commit Mayor)* | 1. Nama produk lama ("WAGW") membingungkan.<br>2. File `wabot.js` berupa monolit 850+ baris yang memuat bot, OTA, webhook, auto-read yang rentan ban WA dan tidak sesuai lingkup SMS.<br>3. Windows Service dijalankan via batch script tidak aman.<br>4. Autentikasi browser Basic Auth di Linux mudah bocor.<br>5. Skema DB bernama `wagw` bukan identitas JIBAS. | 1. Rename proyek ke JIBAS WhatsApp Gateway.<br>2. Monolit `wabot.js` dipecah menjadi modul-modul terpisah (`gateway.js`, `database.js`, `bridge.js`). Menghapus seluruh kode webhook, OTA, dan bot executor.<br>3. Windows Service diperketat menggunakan WinSW dan berjalan sebagai `LocalService` dengan pembatasan hak ACL folder.<br>4. Autentikasi diganti menjadi server-side form login (`/login`) dengan cookie HTTP-only dan hashing scrypt.<br>5. Database gateway beralih ke `jibas_wg` dengan kompatibilitas backwards untuk instalasi lama `wagw`. |
| **`487c501`** | *Fix Linux Bash validation and keep Git publishing logs quiet* | 1. Script bash `dashboard.sh` dan `service.sh` gagal dalam validasi `bash -n` / shellcheck karena ketiadaan shebang `#!/usr/bin/env bash`.<br>2. Pada `Publish-GitHub.ps1`, variabel env `GIT_TRACE='0'` menyebabkan Git menulis log trace ke file literal bernama `0`. | 1. Menambahkan shebang `#!/usr/bin/env bash` pada file-file shell script terkait.<br>2. Mengatur variabel tracing Git menjadi `$null` dan mengaktifkan `GIT_TRACE_REDACT='1'`. |
| **`9064d57`** | *Verify Ubuntu migration and wait for Nginx graceful reload* | 1. Ekstraksi tarball Node.js resmi di Linux mempertahankan UID/GID arsip sehingga menyebabkan error perizinan file.<br>2. Race condition pada Nginx reload saat testing (port belum tertutup saat dicek ulang).<br>3. Pengujian migrasi dari versi legacy `/opt/wagw` belum terverifikasi. | 1. Menambahkan opsi `--no-same-owner` pada perintah `tar -xJf` di `deployment/linux/install.sh`.<br>2. Menambahkan fungsi helper `wait_port_closed` yang melakukan polling pelepasan port sebelum verifikasi tahap berikutnya.<br>3. Menambahkan skenario test migrasi direktori legacy `/opt/wagw` ke `/opt/jibas-wg` pada `test-systemd.sh`. |
| **`5fc465c`** | *Refresh dashboard pairing automatically and document validation* | 1. Tampilan QR Code di dashboard web tidak otomatis berganti saat Baileys mengeluarkan QR code baru.<br>2. Pada installer Linux, perintah tar `--exclude='config.json'` berisiko mengecualikan file nested yang tidak disengaja. | 1. Menambahkan timer polling status 3 detik di `public/app.js` saat tab aktif (`!document.hidden`).<br>2. Mengubah aturan exclude tar menjadi `--anchored --exclude='./config.json'`.<br>3. Menambahkan unit test UI `test-dashboard-ui.js`. |
| **`821de72`** | *Document agent contract and refresh project README* | Batas operasional, kontrak data, dan aturan intervensi produksi belum didokumentasikan secara ketat untuk agent otomatis. | Membuat dokumen `CONTRACT.md` dan merevisi `README.md` secara komprehensif. |

---

## 4. Analisis Runtime Error Nyata (Berdasarkan Log)

Pemeriksaan pada file log di direktori kerja menemukan dua error runtime yang sempat terjadi pada masa sebelumnya:

### 1. `error_log.txt`: Kegagalan Koneksi Database (`ECONNREFUSED`)
- **Pesan Log**:
  ```text
  ❌ Error DB Connect: connect ECONNREFUSED 172.16.103.253:3306
  Gagal menjankan kueri DB: connect ECONNREFUSED 172.16.103.253:3306
  ```
- **Penyebab**:
  Host database yang tercatat di `config.json` (`172.16.103.253`) tidak aktif atau port 3306 diblokir firewall LAN.
- **Dampak pada kode lama**: Pada versi monolit lama (`wabot.js.pre-install.bak`), setiap kegagalan kueri memicu `initDatabase()` berulang-ulang tanpa jeda yang wajar, membanjiri log ratusan baris per menit.
- **Penyelesaian pada arsitektur baru**: Di `deployment/start-gateway.js`, koneksi database dikontrol via `db.on('error', fail)`. Jika database terputus atau gagal di awal, proses langsung keluar (`process.exit(1)`) sehingga Service Manager (systemd / WinSW) dapat melakukan backoff restart yang tertib daripada spamming kueri secara liar.

### 2. `output_log.txt`: Badai Reconnect Akibat Konflik Sesi WhatsApp (`conflict: replaced`)
- **Pesan Log**:
  ```json
  {"level":50,"time":"2026-11-18T18:14:22.300Z","pid":8016,"hostname":"SiakadSupportApp","class":"baileys","reasonNode":{"tag":"conflict","attrs":{"type":"replaced"}},"fullErrorNode":{"tag":"stream:error","attrs":{},"content":[{"tag":"conflict","attrs":{"type":"replaced"}}]},"msg":"stream errored out"}
  Koneksi ditutup. Reason: Stream Errored (conflict)
  Mencoba menyambung kembali dalam 5 detik...
  ```
- **Penyebab**:
  Nomor WhatsApp (`6285117247433`) dihubungkan oleh perangkat/browser/instance gateway lain pada saat bersamaan. Server WhatsApp memutuskan koneksi lama dengan status `conflict: replaced`.
- **Dampak pada kode lama**: Kode legacy hanya memeriksa apakah disconnect disebabkan oleh `loggedOut`. Karena `conflict` bukan `loggedOut`, ia mengeksekusi `setTimeout(startSession, 5000)` terus-menerus. Akibatnya terjadi "ping-pong kick" antara dua instance tanpa henti.
- **Penyelesaian pada arsitektur baru**: Di `gateway.js`, status `DisconnectReason.connectionReplaced` ditangkap secara eksplisit:
  ```javascript
  if (code === DisconnectReason.connectionReplaced || code === DisconnectReason.loggedOut) {
      waWanted = false;
      waState = code === DisconnectReason.connectionReplaced ? "conflict" : "logged_out";
      console.error(waState === "conflict"
          ? "Sesi WhatsApp digantikan koneksi lain. Hentikan instance duplikat lalu mulai ulang sesi."
          : "Sesi WhatsApp tidak lagi tertaut. Tautkan ulang melalui dashboard.");
      return; // Menghentikan retry loop!
  }
  ```

---

## 5. Analisis Proses Instalasi: Titik Rawan Error & Solusi

### A. Lingkungan Windows

| No | Potensi Kendala / Titik Gagal | Penyebab Teknis | Rekomendasi Solusi & Perbaikan |
| :--- | :--- | :--- | :--- |
| 1 | **Eksekusi Script Batch di PowerShell** | Pengguna menjalankan `.\Install_to_Windows_Service.bat` dari PowerShell. Script `.bat` ini memanggil `powershell.exe` kembali di dalamnya (double shell invocation). Passing argumen (seperti `--pass`, tanda petik, path) rawan terpotong atau rusak oleh parser `cmd.exe`. | **Migrasikan langsung ke script native PowerShell `.ps1`** (`Install-Windows-Service.ps1`). Sediakan parameter typed dan validasi native PowerShell. |
| 2 | **Kebijakan Eksekusi (`ExecutionPolicy`)** | PowerShell di Windows 10/11 secara default menerapkan `Restricted` atau `RemoteSigned`. Pengguna yang menjalankan file `.ps1` langsung akan menemui error: `File ... cannot be loaded because running scripts is disabled on this system`. | Script pembuka / dokumentasi harus menyediakan cara eksekusi otomatis dengan parameter `-ExecutionPolicy Bypass`, atau script menyediakan commandlet self-bypass. |
| 3 | **Hak Akses Administrator** | Registrasi service SCM Windows (`Win32_Service`) dan modifikasi ACL direktori memerlukan elevasi Administrator penuh. | Script PowerShell harus mendeteksi hak admin di baris pertama (`Assert-JibasAdmin`). Jika bukan admin, script dapat melakukan auto-elevasi (`Start-Process powershell -Verb RunAs`) atau memberikan instruksi jelas dalam bahasa Indonesia. |
| 4 | **Lokasi Folder di Bawah Profil Pengguna (`C:\Users\...`)** | Service `JIBAS_WG.exe` berjalan sebagai akun `NT AUTHORITY\LocalService`. Windows melarang akun `LocalService` membaca folder di dalam profil pengguna (`C:\Users\Username`). | Peringatan pra-syarat wajib ditampilkan secara mencolok jika repo di-clone di `Desktop` atau `Documents`. Sarankan path standar seperti `C:\JIBAS_WG`. |
| 5 | **Server Offline / Air-Gapped (Node.js & npm)** | Banyak server sekolah tidak memiliki akses internet langsung. `install.ps1` mencoba mengunduh Node.js dari `https://nodejs.org/dist/...` jika versi lokal tidak memenuhi syarat. | Installer harus mendeteksi ketersediaan Node.js portable offline (misalnya file `node.exe` yang ditaruh di root atau di `.runtime\node\`). Jika sudah ada, jangan pernah mencoba mengunduh ke internet. |
| 6 | **Konflik Port Dashboard (Port 3000)** | Port 3000 sering kali digunakan oleh software lain (seperti Grafana, dev server, atau aplikasi web sekolah). Pengguna awam sering salah mengira bahwa mereka harus mengganti `db_port` (3306), bukan `port` web. | Installer harus menampilkan pesan kesalahan yang sangat edukatif: membedakan dengan jelas antara `port` dashboard (3000) dan `db_port` database JIBAS (3306). |
| 7 | **Antivirus / Windows Defender False Positive** | Binari wrapper service `winsw.exe` atau `JIBAS_WG.exe` terkadang dicurigai oleh Windows Defender heuristik. | Tambahkan catatan pengecualian folder (exclusion) pada dokumentasi dan panduan troubleshooting. |

---

### B. Lingkungan Linux (Ubuntu/Debian)

| No | Potensi Kendala / Titik Gagal | Penyebab Teknis | Rekomendasi Solusi & Perbaikan |
| :--- | :--- | :--- | :--- |
| 1 | **Hak Akses Root / Sudo** | Instalasi systemd unit, pembuatan user sistem `jibas-wg`, dan instalasi Nginx mutlak membutuhkan hak `sudo`. | Installer `install.sh` sudah memiliki pengecekan `[[ ${EUID} -eq 0 ]] || die 'Run installer with sudo'`. Pastikan pesan petunjuk jelas bagi pengguna. |
| 2 | **Konflik Port Web Server (Apache/XAMPP vs Nginx)** | Di server JIBAS Linux, web server Apache biasanya sudah berjalan di port 80 dan 443. Saat installer memasang Nginx, Nginx default site dapat gagal start jika mencoba mendengarkan di port 80 yang sudah dipakai Apache. | Installer sudah melakukan `unlink /etc/nginx/sites-enabled/default`. Namun, pastikan installer memverifikasi bahwa konfigurasi Nginx hanya mengikat port dashboard khusus (default 3000) dan tidak pernah mencoba membajak port 80/443 milik Apache JIBAS. |
| 3 | **Lingkungan Non-systemd (Docker / WSL)** | Pengguna yang mencoba menguji coba di container Docker standar atau WSL tanpa systemd aktif akan gagal di pengecekan `[[ -d /run/systemd/system ]]`. | Dokumentasikan secara eksplisit bahwa sistem operasi target harus memiliki systemd aktif (misal VM Ubuntu 22.04 / 24.04 LTS atau VPS). |
| 4 | **Peringatan Sertifikat SSL Self-Signed di Browser** | Nginx dikonfigurasi menggunakan SSL self-signed untuk mengamankan kredensial login via HTTPS lokal. Browser modern akan menampilkan layar merah/peringatan `NET::ERR_CERT_AUTHORITY_INVALID`. | Pengguna awam sering mengira ini error aplikasi. Dokumentasi harus memandu langkah klik "Advanced" -> "Proceed to localhost (unsafe)" atau cara menambahkan sertifikat ke trust store. |
| 5 | **Kegagalan `apt-get` Akibat Lock File** | Pada VPS baru, proses latar belakang seperti `unattended-upgrades` sering kali menahan lock `/var/lib/dpkg/lock-frontend`. | Tambahkan toleransi / retry atau pesan ramah yang meminta menunggu proses update sistem selesai sebelum menjalankan installer. |

---

## 6. Instruksi & Rencana Kerja untuk Agent Berikutnya: Migrasi `.bat` ke `.ps1`

Sesuai permintaan pengguna:
> *"minta agent berikut nya agar ganti file .bat ke ps1 agar mudah di eksekusi powershell."*

Berikut adalah arsitektur teknis dan panduan implementasi yang harus dikerjakan oleh agent penerus:

### A. Rencana File Baru
Buat file script PowerShell di root direktori proyek:
1. **`Install-Windows-Service.ps1`** (menggantikan / memodernisasi `Install_to_Windows_Service.bat`)
2. **`Uninstall-Windows-Service.ps1`** (menggantikan / memodernisasi `Uninstall_Windows_Service.bat`)

*(Catatan Kompatibilitas: File `.bat` lama dapat dipertahankan sebagai wrapper 1-baris tipis atau digantikan, namun script utama dan dokumentasi harus mengarahkan ke `.ps1`)*.

### B. Spesifikasi Teknis `Install-Windows-Service.ps1`
Script ini harus memiliki fitur-fitur PowerShell idiomatik berikut:
1. **Atribut CmdletBinding & Param Block**:
   ```powershell
   [CmdletBinding()]
   param(
       [Parameter(Mandatory=$false)][string]$User,
       [Parameter(Mandatory=$false)][string]$Pass,
       [Parameter(Mandatory=$false)][string]$PassFile,
       [Parameter(Mandatory=$false)][switch]$CredentialsOnly,
       [Parameter(Mandatory=$false)][switch]$NoActivateMove,
       [Parameter(Mandatory=$false)][switch]$PauseOutbox,
       [Parameter(Mandatory=$false)][switch]$DbOnly,
       [Parameter(Mandatory=$false)][switch]$Help
   )
   ```
2. **Auto-Elevation / Admin Check**:
   Jika pengguna lupa menjalankan PowerShell sebagai Administrator, script harus mendeteksinya dengan rapi:
   ```powershell
   $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
   if (-not $isAdmin) {
       Write-Warning "Skrip ini memerlukan hak Administrator untuk mendaftarkan Windows Service."
       Write-Host "Membuka sesi PowerShell Administrator baru..." -ForegroundColor Cyan
       Start-Process powershell.exe -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" " + ($args -join ' ')) -Verb RunAs
       exit
   }
   ```
3. **Penerusan Argumen ke `deployment\windows\install.ps1`**:
   Script root bertindak sebagai fasilitator yang memanggil `deployment\windows\install.ps1` dengan seluruh parameter yang sesuai.
4. **Validasi Lokasi Folder**:
   Cek apakah direktori berada di dalam `C:\Users\`. Berikan peringatan langsung sebelum proses instalasi panjang dimulai.

### C. Spesifikasi Teknis `Uninstall-Windows-Service.ps1`
Script uninstaller native PowerShell:
1. Memiliki parameter `[CmdletBinding()]`.
2. Memeriksa status administrator.
3. Memanggil `deployment\windows\manage-service.ps1 -Action Uninstall`.
4. Menampilkan konfirmasi bahwa database, log, config, dan sesi WhatsApp tidak dihapus.

### D. Pembaruan Dokumentasi Terkait
Setelah file `.ps1` dibuat, agent berikutnya harus memperbarui rujukan perintah instalasi Windows pada file-file berikut:
- `README.md`
- `ReadMe.TXT`
- `deployment/WINDOWS.md`
- `CONTRACT.md`

Dari sebelumnya:
```powershell
.\Install_to_Windows_Service.bat
```
Menjadi:
```powershell
.\Install-Windows-Service.ps1
# atau jika kebijakan script dibatasi:
powershell -ExecutionPolicy Bypass -File .\Install-Windows-Service.ps1
```

---

## 7. Checklist Tindakan untuk Agent Penerus (Action Items)

Agent berikutnya diharapkan menyelesaikan tugas dengan tahapan terukur berikut:

- [x] **Langkah 1**: Buat `Install-Windows-Service.ps1` di root dengan dukungan parameter lengkap dan penanganan hak Administrator.
- [x] **Langkah 2**: Buat `Uninstall-Windows-Service.ps1` di root untuk pencabutan service secara bersih.
- [x] **Langkah 3**: Pertahankan atau sesuaikan file `.bat` (jika diperlukan untuk backward-compatibility pengguna yang mengklik dua kali file dari Windows Explorer).
- [x] **Langkah 4**: Periksa kembali `deployment/windows/install.ps1` untuk memastikan penanganan mode offline berjalan mulus jika `node.exe` sudah ada di root atau `.runtime/node`.
- [x] **Langkah 5**: Perbarui dokumentasi (`README.md`, `ReadMe.TXT`, `deployment/WINDOWS.md`, `CONTRACT.md`) agar merefleksikan instruksi eksekusi PowerShell yang baru.
- [x] **Langkah 6**: Jalankan seluruh unit test (`npm test`) untuk memastikan tidak ada invariant atau kontrak yang terlanggar.
