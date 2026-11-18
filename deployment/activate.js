'use strict';
require('./move').changeMove(true).catch(err=>{console.error(err.code||'',err.message);process.exitCode=1;});
