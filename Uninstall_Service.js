var Service = require('node-windows').Service;

var svc = new Service({
  name:'WAGW PRO',
  script: require('path').join(__dirname, 'wabot.js')
});

svc.on('uninstall', function(){
  console.log('========================================================================');
  console.log('❌ Service "WAGW PRO" berhasil dihapus.');
  console.log('========================================================================');
});

svc.uninstall();
