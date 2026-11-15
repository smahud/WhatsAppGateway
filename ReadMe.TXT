======================================================
     PANDUAN LENGKAP WABOT PRO: INSTALASI & PENGGUNAAN
======================================================
  
Selamat datang di Wabot Pro. Bot WhatsApp/Gateway ini dapat dikontrol melalui Database SQL dan Dashboard Web, serta dapat berjalan selamanya sebagai Background Service.

1. PERSIAPAN DATABASE (MySQL, Oracle, atau SQL Server)
------------------------------------------------------
Sebelum menjalankan Bot, pastikan struktur database Anda (Tabel) sudah ada. 
Gunakan *SQL Dump* yang telah disediakan sesuai dengan engine yang Anda pakai:
- Create Tables - MySQL.sql
- Create Tables - Oracle.sql
- Create Tables - SQLServer.sql

*Pastikan Tabel yang wajib ada:* inbox, outbox, sent.

2. KONFIGURASI BOT
------------------------------------------------------
Wabot Pro membaca semua setting di file "config.json". 
Anda bisa mengedit isinya langsung atau mengaksesnya dari halaman Web.
Pastikan parameter "db_type" (bisa diisi: mysql / oracle / sqlserver) sesuai dengan pilihan Anda. Semua koneksi db di atur di sana.
Delay / jeda waktu pengiriman pesan (default 10 detik) juga tercatat pada config file ini.

3. CARA MENJALANKAN (PILIH SALAH SATU)
------------------------------------------------------
CARA A: Manual (Konvensional, layar terminal jangan ditutup)
1) Buka file "START.bat" atau ketik "node wabot.js" di command prompt.
2) Bot akan nyala, dan terminal (CMD) akan tetap terbuka.

CARA B: Otomatis di Latar Belakang (Jalan Terus Selamanya)
1) Jalankan "Install_to_Windows_Service.bat" (Klik dua kali).
2) Jika muncul notifikasi (UAC) Windows, klik Yes / Run.
3) Tunggu notifikasi "Service Wabot Pro berhasil diinstal". Selesai!
(Anda bisa menghapusnya suatu saat dengan "Uninstall_Windows_Service.bat")

4. CARA LOGIN WHATSAPP & AKSES KONTROL
------------------------------------------------------
Setelah bot dijalankan (menggunakan cara apa pun di atas), Anda tidak perlu menggunakan terminal lagi.
Buka web browser dan kunjungi:
-> http://localhost:3000

Di dalam alamat ini, Anda akan melihat "Dashboard Modern Wabot Pro".
1) Jika WhatsApp belum terkoneksi, akan muncul QR-Code di layar utama Web. Gunakan HP untuk scan QR tersebut (Linked Devices).
2) Anda dapat menggunakan menu di sebelah kiri untuk mengubah pengaturan, tes kirim text, serta memantau antrean *Outbox* atau *Sent* tanpa membuka Database secara manual!

5. ATURAN PENGIRIMAN OUTBOX BERDASARKAN DATABASE WABOT
------------------------------------------------------
Untuk mengirim pesan secara masal, cukup masukkan/insert baris data (records) baru ke Tabel "outbox". Terdapat kolom-kolom:
- wa_no : Nomor Tujuan (contoh: 628123456789)
- wa_text : Teks Pesan utama (wajib jika tidak ada file media)
- wa_media : Lokasi path file absolut untuk Gambar (e.g. C:\Image\promo.jpg)
- wa_file : Lokasi path file absolut/relative untuk Dokumen (PDF/DOC)

*FORMAT KHUSUS UNTUK TOMBOL/POLLING DI DALAM KOLOM `wa_text`:*
a. Polling Message:
   Ketik dalam tabel wa_text: 
   POLLVOTE! Apakah ini menarik?:Ya, Menarik:Tidak Menarik
   (Gunakan tanda Titik Dua (:) sebagai pemisah caption & Opsi).

b. URL Button Message:
   Ketik dalam tabel wa_text:
   TEXTWITHBUTTON! Pesan caption di sini|Link1|http://link1.com|Beli|http://beli.com
   (Gunakan tanda Pipa (|)  sebagai pemisah antara pesan, Nama Tombol, URL tombol).

Setelah berhasil dikirim (diproses tiap sekian detik), Wabot akan otomatis memindahkan rekam jejaknya ke tabel "sent".

6. INTEGRASI WEBHOOK (Koneksi Pesan Masuk Ke Sistem Anda)
------------------------------------------------------
Wabot menyimpan log pesan masuk ke tabel "inbox".
Selain itu, Anda dapat mem-by-pass secara live JSON pesan masuk tersebut ke API Script Server milik Anda Sendiri.
Caranya: 
Buka dashboard konfigurasi http://localhost:3000, isi link Webhook pada kolom Webhook_URL (Contoh: http://localhost/projectx/webhook.php).
Sebagai referensi cara menangkap *payload* atau datanya di PHP, buka file contoh "webhook.php" yang disertakan di direktori script ini.

---
Terima kasih telah menggunakan Wabot Pro.
