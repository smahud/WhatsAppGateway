'use strict';
// Compatibility for installations whose existing service points to this file.
module.exports = require('./gateway');
if (require.main === module) require('./deployment/start-gateway').run();
