# Instalasi lokal WAGW - 13 November 2026

> Catatan historis instalasi awal. Status aktif dan instruksi terbaru ada di
> [README proyek](../README.md), [CONTRACT.md](../CONTRACT.md), dan [OUTBOX.md](OUTBOX.md).
> Bagian di bawah tentang mode salinan dan belum adanya bridge sudah digantikan
> oleh implementasi outbox move.

Dashboard: http://localhost:3000
Database: MariaDB 10.4.32, 127.0.0.1:3434, wagw. Kredensial ada di config.json.

Source WAGW dan JIBAS tidak diubah. Perubahan source awal sudah dikembalikan;
wabot.js diverifikasi sama dengan wabot.js.pre-install.bak.
Database wagw dibuat saat belum ada dan schema bawaan diimpor. Database jbssms tidak diubah.

## Menjalankan dan menghentikan

Dari PowerShell pada folder proyek:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Start-WAGW.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployment\Stop-WAGW.ps1
```

Peluncur start-wagw.js memberikan db_port ke mysql2 saat runtime karena source asli
tidak meneruskan opsi port. Tidak ada file library yang diubah.
Gunakan peluncur ini untuk port 3434; START.bat dan installer service asli tidak
memuat adapter ini. Instalasi saat ini berjalan sebagai proses latar belakang,
belum sebagai Windows Service dan belum otomatis berjalan setelah reboot.
Stop hanya menargetkan PID yang dicatat peluncur; hindari STOP.bat bawaan yang
menghentikan semua node.exe. Log ada di output_log.txt dan error_log.txt.

## WhatsApp

Buka dashboard dan pindai QR melalui WhatsApp > Perangkat tertaut.
Jangan logout atau menghapus sesi versi lama. Sesi versi baru tersimpan di sessions.
Verifikasi nomor akun yang akan dipakai sebelum mengirim pesan nyata.

## Integrasi SMS JIBAS

Kode JIBAS ditemukan di C:\YIM\JIBAS\xampp\htdocs\jibas\smsgateway.
Modul pengumuman, presensi, penilaian dan balasan menulis ke jbssms.outbox.

View wagw.jibas_outbox_mapping hanya membaca antrean, tidak mengirim pesan.
Definisinya ada di jibas-mapping.sql:

| JIBAS | WAGW |
| --- | --- |
| DestinationNumber | wa_no; nomor 08/8 dikonversi ke 628 |
| Text, fallback TextDecoded | wa_text |
| ID | jibas_outbox_id untuk deduplikasi |
| SendingDateTime | scheduled_at, harus dihormati bridge |
| idsmsgeninfo | referensi kelompok pengiriman |

Belum ada bridge otomatis atau trigger penerusan. Pilih mode sebelum aktivasi:

- Kombinasi: SMS tetap diproses layanan lama; salinan WhatsApp dicatat secara
  transaksional di antrean terpisah dengan kunci unik sumber untuk deduplikasi.
  Polling outbox saja dapat melewatkan pesan yang cepat dihapus gateway lama;
  perlu titik capture yang disepakati (misalnya trigger insert) sebelum produksi.
- Migrasi: hanya satu consumer yang boleh mengambil antrean; perlu identifikasi
  layanan lama dan prosedur cutover agar tidak mengirim ulang atau menghilangkan SMS.

Bridge harus memvalidasi nomor, jadwal, pesan kosong, panjang teks maksimum schema
WAGW 2000 karakter, serta multipart sebelum mengantrekan. Status sent WAGW berarti
hasil pengiriman library, bukan bukti delivery SMS; jangan langsung menyalinnya
ke status JIBAS tanpa mapping yang sesuai.

Saat pemeriksaan, jbssms.outbox dan outboxhistory kosong. Versi lama yang disebut
pengguna belum berhasil diidentifikasi proses/lokasi pastinya; tidak dihentikan.

## Verifikasi

- Semua dependency utama dapat dimuat menggunakan node.exe bawaan v22.14.0.
- Koneksi MySQL berhasil dan schema wagw berisi 10 tabel bawaan.
- Uji INSERT outbox berhasil dalam transaksi kemudian rollback; tidak ada pesan uji tersisa.
- GET / dan /api/inbox, /api/outbox, /api/sent menghasilkan HTTP 200.
- /api/status: dbConnected=true, ready=false, QR tersedia saat pemeriksaan.
- Pairing WhatsApp, pengiriman nyata, dan bridge JIBAS belum diverifikasi.
