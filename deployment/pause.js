'use strict';
require('./move').changeMove(false).catch(err=>{console.error(err.code||'',err.message);process.exitCode=1;});
