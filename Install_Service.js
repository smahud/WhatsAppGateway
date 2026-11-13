var Service = require('node-windows').Service;

var svc = new Service({
  name:'WAGW PRO',
  description: 'WAGW PRO WhatsApp Gateway Backend Service.',
  script: require('path').join(__dirname, 'wabot.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

svc.on('install', function(){
  svc.start();
  console.log('========================================================================');
  console.log('✅ Service "WAGW PRO" berhasil diinstal dan dijalankan otomatis.');
  console.log('========================================================================');
  console.log('Bot akan otomatis berjalan di latar belakang setiap Windows menyala.');
  const fs = require('fs');
  const path = require('path');
  let port = 3000;
  try {
      const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
      if(cfg.port) port = cfg.port;
  } catch(e){}
  console.log(`Anda bisa langsung membuka Dashboard di http://localhost:${port}`);
  console.log('Untuk melepas service ini, jalankan Uninstall_Windows_Service.bat');
});

// Menangkap error jika sudah pernah ter-instal atau masalah hak akses (Run As Administrator)
svc.on('error', function(err) {
  console.error("Terjadi masalah mendaftarkan Windows Service. Pastikan Anda menjalankan ini sebagai Administrator:", err);
});

svc.install();
