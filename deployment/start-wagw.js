'use strict';
// Compatibility for an already registered service; new installs start start-gateway.js.
const gateway = require('./start-gateway');
module.exports = gateway;
if (require.main === module) gateway.run();
