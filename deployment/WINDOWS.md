# JIBAS WhatsApp Gateway di Windows

1. Clone atau ekstrak paket ke folder khusus, misalnya `C:\JIBAS_WG`, di luar profil pengguna.
2. Salin `config.example.json` menjadi `config.json`. Isi kredensial DB JIBAS, termasuk `db_port` yang benar. `port` adalah port dashboard, default `3000`.
3. Buka PowerShell **Administrator**, masuk ke folder proyek, dan jalankan:

```powershell
.\Install-Windows-Service.ps1
# atau jika kebijakan script dibatasi:
powershell -ExecutionPolicy Bypass -File .\Install-Windows-Service.ps1
```

> **Catatan:** File `.bat` lama (`Install_to_Windows_Service.bat`) tetap tersedia sebagai wrapper kompatibilitas untuk klik-dua-kali dari Explorer.

Installer memakai Node yang cocok atau mengunduh runtime privat `.runtime/node`, memasang dependensi dari lockfile, menyiapkan trigger JIBAS, dan menjalankan service `JIBAS_WG.exe` sebagai `LocalService`. Instalasi normal mengaktifkan MOVE; hentikan consumer SMS lama dan tinjau antrean sebelum cutover. Gunakan `-NoActivateMove` bila perlu staging.

Tanpa opsi login, instalasi pertama menampilkan `admin` dan password acak sekali. Buka `http://127.0.0.1:3000/login`. Pada instalasi yang sudah ada, repair tanpa opsi login mempertahankan kredensial. `--user` saja menetapkan user dan membuat password baru; `--pass`/`--pass-file` tanpa `--user` mengganti password user yang sudah tersimpan. Rinciannya ada di [README](../README.md#login-dan-perbaikan).

## Perbaiki atau lepas service

```powershell
.\Install-Windows-Service.ps1
.\Uninstall-Windows-Service.ps1
```

Saat install, port asing ditolak sebelum bootstrap; ubah `port` di `config.json`. Jika listener berasal dari service gateway milik folder ini, installer menyiapkan dependensi dan memeriksa DB, lalu melakukan restart terkontrol. Registrasi lama `wagwpro.exe` dari folder yang sama dilepas setelah service baru siap. Registrasi dari folder lain tidak diambil alih. Nonaktifkan task scheduler JIBAS lama sebelum migrasi.

```powershell
Get-Service -Name JIBAS_WG.exe
Invoke-RestMethod http://127.0.0.1:3000/healthz
.\Install-Windows-Service.ps1 -CredentialsOnly -PassFile "C:\Private\jibas-wg.pass"
```

Port pada URL harus mengikuti config. `/healthz` melaporkan `pid`, `dbConnected`, dan `jibasReady`, tanpa QR atau pesan. Log service ada di `daemon/logs/`. Uninstall melepas service, tidak menghapus data/config/sesi/trigger. Dashboard HTTP hanya di loopback.

Tes berikut hanya untuk database loopback disposable dengan `jbssms.outbox` kosong. Tambahkan tabel `jbssms.gateway_test_fixture(purpose VARCHAR(60))` berisi satu baris `JIBAS WG disposable fixture`. Akun fixture harus dapat membuat tabel sementara dan memasukkan pesan uji di database disposable, bukan diberi akses ini di JIBAS produksi.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Test-Windows-Service.ps1 -FixtureConfig "C:\Private\fixture-config.json"
```
