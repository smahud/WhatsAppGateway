'use strict';

const filtered = new WeakSet();
const keyRecord = /^(Closing session:|Opening session:|Removing old closed session:|Session already closed|V1 session storage migration error:)/;

// libsignal logs whole session objects directly to console, bypassing the Baileys logger.
function redactSessionLogs(logger) {
  if (filtered.has(logger)) return;
  filtered.add(logger);
  for (const level of ['info', 'warn', 'error']) {
    const output = logger[level].bind(logger);
    logger[level] = (message, ...args) => {
      if (typeof message === 'string' && keyRecord.test(message)) return;
      output(message, ...args);
    };
  }
}

module.exports = { redactSessionLogs };
