# JIBAS WhatsApp Gateway di Windows

1. Clone atau ekstrak paket ke folder khusus, misalnya `C:\JIBAS_WG`, di luar profil pengguna.
2. Salin `config.example.json` menjadi `config.json`. Isi kredensial DB JIBAS, termasuk `db_port` yang benar. `port` adalah port dashboard, default `3000`.
3. Buka PowerShell **Administrator**, masuk ke folder proyek, dan jalankan:

```powershell
.\Install-Windows-Service.ps1
# atau jika kebijakan script dibatasi:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Windows-Service.ps1
```

Installer memakai Node yang cocok atau mengunduh runtime privat `.runtime/node`, memasang dependensi dari lockfile, menyiapkan trigger JIBAS, dan menjalankan service `JIBAS_WG.exe` sebagai `LocalService`. Instalasi normal mengaktifkan MOVE; hentikan consumer SMS lama dan tinjau antrean sebelum cutover. Gunakan `-NoActivateMove` bila perlu staging.

Tanpa opsi login, instalasi pertama menampilkan `admin` dan password acak sekali. Buka `http://127.0.0.1:3000/login`. Pada instalasi yang sudah ada, repair tanpa opsi login mempertahankan kredensial. `-User` saja menetapkan user dan membuat password baru; `-Pass`/`-PassFile` tanpa `-User` mengganti password user yang sudah tersimpan. Utamakan `-PassFile` dengan file privat UTF-8 satu baris. Rinciannya ada di [README](../README.md#login-dan-perbaikan).

## Upgrade di folder yang sama

1. Cadangkan database, `config.json`, `dashboard-auth.json`, dan `sessions/`. Hentikan consumer SMS atau task scheduler JIBAS lama sesuai [gerbang produksi](../CONTRACT.md#gerbang-produksi-dan-rollback).
2. Perbarui source **di folder instalasi yang sudah ada** tanpa menimpa config, login, atau sesi. Jangan mengubah nama schema `wagw` pada instalasi lama. Hapus hanya installer/uninstaller batch lama yang telah digantikan; jangan hapus berkas di `daemon/` atau launcher yang dirujuk oleh service.
3. Saat siap cutover, jalankan `.\Install-Windows-Service.ps1` dari folder tersebut. Registrasi lama `wagwpro.exe` dari folder yang sama dilepas setelah service baru siap. Registrasi dari folder lain tidak diambil alih.

## Perbaiki atau lepas service

```powershell
.\Install-Windows-Service.ps1
.\Uninstall-Windows-Service.ps1
```

Saat install, port asing ditolak sebelum bootstrap; ubah `port` di `config.json`, bukan `db_port`. Jika listener berasal dari service gateway milik folder ini, installer menyiapkan dependensi dan memeriksa DB, lalu melakukan restart terkontrol. Jika runtime atau npm belum tersedia, bootstrap memerlukan akses ke `nodejs.org`; pemasangan dependensi juga memerlukan registry npm bila paketnya belum tersedia di cache.

```powershell
Get-Service -Name JIBAS_WG.exe
Invoke-RestMethod http://127.0.0.1:3000/healthz
.\Install-Windows-Service.ps1 -CredentialsOnly -PassFile "C:\Private\jibas-wg.pass"
```

Port pada URL harus mengikuti config. `/healthz` melaporkan `pid`, `dbConnected`, dan `jibasReady`, tanpa QR atau pesan. Log service ada di `daemon/logs/`. Uninstall melepas service, tidak menghapus data/config/sesi/trigger. Dashboard HTTP hanya di loopback.

Jika database menolak koneksi (`ECONNREFUSED`), periksa alamat dan port MariaDB/MySQL, bukan port dashboard. Jika dashboard menunjukkan sesi WhatsApp digantikan (`conflict`), hentikan instance duplikat sebelum memulai ulang sesi. Jangan hapus sesi untuk mengatasi konflik proses.

Tes berikut hanya untuk database loopback disposable dengan `jbssms.outbox` kosong. Tambahkan tabel `jbssms.gateway_test_fixture(purpose VARCHAR(60))` berisi satu baris `JIBAS WG disposable fixture`. Akun fixture harus dapat membuat tabel sementara dan memasukkan pesan uji di database disposable, bukan diberi akses ini di JIBAS produksi.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Test-Windows-Service.ps1 -FixtureConfig "C:\Private\fixture-config.json"
```
