# JIBAS WG di Ubuntu/Debian

Gunakan host dengan systemd dan akses `sudo`. Siapkan JIBAS yang sudah berjalan; `jbssms.outbox` dan database gateway (`jibas_wg` untuk instalasi baru) mesti pada satu instance MySQL/MariaDB. Sebelum aktivasi nonaktifkan consumer SMS lama, backup DB, dan periksa antrean. Untuk DB remote, gunakan jaringan privat/VPN dan akun sesuai alamat gateway. Lihat [contoh grant](../README.md#akun-database-jibas).

## Pasang dan akses dashboard

```bash
git clone https://github.com/smahud/WhatsAppGateway.git jibas-wg
cd jibas-wg
test -f config.json || cp config.example.json config.json
nano config.json
sudo bash install.sh
```

Atur koneksi JIBAS dalam `config.json` sebelum menjalankan installer. `port` adalah port publik HTTPS; `db_port` adalah port MariaDB/MySQL. Untuk instalasi baru, runtime ada di `/opt/jibas-wg-runtime`, aplikasi di `/opt/jibas-wg`, dan sertifikat HTTPS di `/etc/jibas-wg`. `backend_port` dikelola installer. Prasyarat pemeriksaan awal: Python 3 dan `ss` (`iproute2`).

Instalasi normal mengaktifkan MOVE dan menjalankan `jibas-wg-gateway.service` serta `jibas-wg-bridge.service`. Bila ada pesan lama yang belum ditinjau:

```bash
sudo bash install.sh --no-activate-move
sudo -u jibas-wg /opt/jibas-wg-runtime/node/bin/node /opt/jibas-wg/deployment/doctor.js
# Setelah consumer SMS lama berhenti dan antrean direkonsiliasi:
sudo -u jibas-wg /opt/jibas-wg-runtime/node/bin/node /opt/jibas-wg/deployment/activate.js
```

Buka `https://IP_SERVER:3000/login`. Pada install pertama tanpa argumen login, simpan password acak untuk `admin` yang dicetak installer. Setelah login, tautkan WhatsApp. Cocokkan fingerprint TLS di terminal sebelum mempercayai sertifikat self-signed. Gunakan `--address IP_PUBLIK_ATAU_DNS` bila akses melewati NAT. Firewall provider hanya perlu membuka port HTTPS; tidak perlu membuka backend/database.

## Repair, rotasi, dan uninstall

```bash
# Repair/upgrade: jalankan dari checkout baru. Edit config di checkout atau gunakan config terpasang.
sudo bash install.sh

# Ubah login tanpa restart atau ubah DB:
sudo bash install.sh --credentials-only --user operator --pass-file /root/jibas-wg.pass

# Lepas JIBAS WG tanpa menghapus data:
sudo bash uninstall.sh
```

Port publik diperiksa sebelum instalasi paket. Bila dipakai aplikasi lain, ubah `port` di `config.json` atau gunakan `--port`. Nginx pada port yang hanya dipakai dashboard atau listener service gateway yang sama dapat diperbaiki otomatis. Unit/site yang bukan milik installer tidak ditimpa. Repair memakai `config.json` dari source bila ada; jika tidak, gunakan config terpasang.

Jika instalasi lama ada di `/opt/wagw`, installer baru menggunakan lokasi aplikasi, runtime, sertifikat, dan akun sistem lama tanpa memindahkan data. Nama unit dan site Nginx beralih ke JIBAS WG. Untuk `doctor.js` atau `activate.js` pada instalasi ini, gunakan akun `wagw`, `/opt/wagw-runtime/node/bin/node`, dan skrip dari `/opt/wagw/deployment/`.

Instalasi lama dengan Basic Auth bcrypt dimigrasikan ke halaman login saat repair. Tanpa argumen login, username/password lama dipertahankan. Untuk password yang diberikan, file privat satu baris lebih aman daripada argumen. Simpan `config.json`, `dashboard-auth.json`, dan `sessions/` sebagai data privat.

## Verifikasi

```bash
systemctl status jibas-wg-gateway.service jibas-wg-bridge.service
sudo journalctl -u jibas-wg-gateway -u jibas-wg-bridge -n 60 --no-pager
backend=$(sudo /opt/jibas-wg-runtime/node/bin/node -p 'require("/opt/jibas-wg/deployment/settings").readConfig().backend_port')
curl --fail "http://127.0.0.1:$backend/healthz"
curl -k -I https://127.0.0.1:3000/
```

Frontend tanpa sesi harus mengarahkan ke `/login`; `healthz` internal memeriksa database dan worker. Uji satu pesan dari **menu SMS JIBAS** ke nomor yang disetujui, bukan hanya tombol uji langsung dashboard. Instalasi penuh, reboot, dan delivery harus diuji di VPS tujuan. Untuk kembali ke SMS lama ikuti [rollback](../CONTRACT.md#penghentian-dan-rollback); uninstall tidak menghapus trigger atau antrean.
