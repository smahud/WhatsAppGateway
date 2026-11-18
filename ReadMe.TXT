JIBAS WHATSAPP GATEWAY (JIBAS WG)

1. Clone atau ekstrak ZIP ke folder khusus.
2. Salin config.example.json menjadi config.json, lalu isi data MariaDB/MySQL
   JIBAS. jibas_wg dan jbssms harus pada instance yang sama. port adalah port
   dashboard; db_port adalah port database.
3. Jalankan Install_to_Windows_Service.bat dari PowerShell Administrator
   atau sudo bash install.sh pada Ubuntu/Debian. Installer juga memperbaiki
   service gateway yang sudah memakai port tersebut. Jika port dipakai aplikasi
   lain, ubah port di config.json.
4. Install pertama tanpa argumen mencetak login admin dan password acak.
   Akses /login dulu, lalu dashboard. Ganti login via --user, --pass,
   atau --pass-file; --credentials-only tidak me-restart layanan.
5. Tautkan WhatsApp dan kirim melalui menu SMS JIBAS. Jika antrean lama
   belum direkonsiliasi, gunakan --no-activate-move untuk staging.
6. Uninstall: Uninstall_Windows_Service.bat atau sudo bash uninstall.sh.
   Config, akun dashboard, sesi, antrean, dan trigger JIBAS tetap ada.

Perintah lengkap dan prasyarat ada di README.md.
