'use strict';
// Deployment adapter only. Original WAGW source and installed modules stay unchanged.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const mysql = require('mysql2/promise');
const originalCreatePool = mysql.createPool;
mysql.createPool = function (options) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const port = Number(config.db_port || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid db_port');
  return originalCreatePool.call(this, { ...options, port });
};
require(path.join(root, 'wabot.js'));
