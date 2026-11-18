# MOVE outbox JIBAS

Integrasi [JIBAS WhatsApp Gateway](../README.md) tidak mengubah source JIBAS. Database gateway dan `jbssms` harus berada pada satu instance MySQL/MariaDB. Nama schema baru adalah `jibas_wg`; pertahankan nama lama bila meng-upgrade instalasi yang sudah ada.

1. Trigger `AFTER INSERT` menangkap `jbssms.outbox` dalam transaksi yang sama. Trigger `AFTER UPDATE` memperbarui pesan/nomor/jadwal untuk job pending atau rejected.
2. Worker menunggu jadwal, mengunci baris sumber, dan memvalidasi isi terbaru. Dalam satu transaksi worker menulis `outbox` gateway, mencatat referensi `bridge_outgoing`, lalu menghapus baris sumber. Jika ada kegagalan, semua langkah dibatalkan.
3. Gateway mengirim teks ke WhatsApp dan mencatat hasil di `sent`. Worker merekonsiliasi hasil tanpa membuat delivery report SMS atau mengubah `jbssms.outboxhistory`.

Named lock mencegah worker ganda pada DB yang sama. Consumer SMS lama tetap harus dihentikan: lock database tidak dapat mencegah consumer lain mengirim SMS di luar transaksi. Tidak ada replay untuk pesan yang belum tercatat saat trigger dipasang.

| Status | Perlakuan |
| --- | --- |
| `pending` | Menunggu jadwal atau proses; sumber masih ada |
| `queued` | Sudah dipindahkan ke antrean gateway; edit riwayat JIBAS tidak membatalkan pesan |
| `sent` / `failed` | Hasil library, bukan bukti diterima/dibaca. Tidak ada pengiriman ulang otomatis |
| `rejected` | Nomor/teks invalid, teks lebih dari 2.000 karakter, multipart/PDU, atau awalan perintah legacy. Sumber tetap ada |
| `cancelled` | Sumber sudah hilang saat worker mengambilnya, jadi salinan lama tidak dikirim |

Jeda MOVE melalui `deployment/pause.js`; antrean gateway yang sudah terisi tidak dibatalkan. Aktifkan kembali dengan `deployment/activate.js` setelah `deployment/doctor.js` menunjukkan `uncaptured: 0` dan consumer lama dihentikan. Lihat [panduan operasional](../README.md#cara-pakai-dari-jibas) untuk memilih runtime Node OS.

Pemantauan (pilih schema dari `config.json` lebih dahulu):

```sql
SELECT id, source_id, state, wagw_id, error, scheduled_at
FROM bridge_outgoing ORDER BY id DESC;
SELECT * FROM bridge_control;
```

`wagw_id` adalah nama kolom kompatibilitas yang menyimpan ID antrean gateway. Jika proses berhenti setelah jaringan mengirim tetapi sebelum pencatatan SQL, pengiriman tepat sekali tidak dijamin. Pairing, penerimaan pada HP, serta fitur SMS seperti PIN, kritik/saran, dan sinkronisasi inbox tidak dibuktikan oleh uji fixture. Ikuti [rollback](../CONTRACT.md#penghentian-dan-rollback) sebelum melepas trigger atau beralih ke SMS lama.
