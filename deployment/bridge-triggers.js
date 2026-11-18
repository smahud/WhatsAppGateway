'use strict';

const {gatewaySchema, DEFAULT_SCHEMA, LEGACY_SCHEMA} = require('./settings');

function definitions(schema) {
  const prefix = gatewaySchema(schema);
  return [
    [`${prefix}_capture_outbox`, 'INSERT', `INSERT INTO ${prefix}.bridge_outgoing(source_id,destination,message,scheduled_at,multipart)
    VALUES(NEW.ID,NEW.DestinationNumber,COALESCE(NULLIF(NEW.Text,''),NEW.TextDecoded),NULLIF(NEW.SendingDateTime,'0000-00-00 00:00:00'),NEW.MultiPart)`],
    [`${prefix}_update_outbox`, 'UPDATE', `UPDATE ${prefix}.bridge_outgoing SET destination=NEW.DestinationNumber,message=COALESCE(NULLIF(NEW.Text,''),NEW.TextDecoded),scheduled_at=NULLIF(NEW.SendingDateTime,'0000-00-00 00:00:00'),multipart=NEW.MultiPart,state='pending',error=NULL WHERE source_id=NEW.ID AND state IN ('pending','rejected')`]
  ];
}

// Normalize identifiers and formatting without changing SQL string literals.
function canonical(sql) {
  return (sql.match(/'(?:''|\\.|[^'\\])*'|`[A-Za-z0-9_$]+`|[A-Za-z0-9_$]+|[^\s;]/g) || [])
    .map(token => token.startsWith("'") ? token : token.replace(/`/g, '').toLowerCase()).join(' ');
}

async function inspectTriggers(db, schema, {required = false} = {}) {
  const own = definitions(schema);
  const otherSchema = schema === LEGACY_SCHEMA ? DEFAULT_SCHEMA : LEGACY_SCHEMA;
  const names = [...own, ...definitions(otherSchema)].map(([name]) => name);
  const [rows] = await db.execute(
    `SELECT TRIGGER_NAME, ACTION_STATEMENT, EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING
     FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='jbssms' AND TRIGGER_NAME IN (?,?,?,?)`, names);
  const missing = [];
  for (const trigger of rows) {
    const spec = own.find(([name]) => name === trigger.TRIGGER_NAME);
    if (!spec) throw Error(`Trigger ${trigger.TRIGGER_NAME} sudah memakai schema ${otherSchema}. Gunakan database=${otherSchema}; jangan buat antrean kedua.`);
    const [name, event, body] = spec;
    if (trigger.EVENT_OBJECT_TABLE !== 'outbox' || trigger.EVENT_MANIPULATION !== event ||
        trigger.ACTION_TIMING !== 'AFTER' || canonical(trigger.ACTION_STATEMENT) !== canonical(body)) {
      throw Error(`Trigger ${name} differs; stop JIBAS writes and review the definition. No trigger was dropped.`);
    }
  }
  for (const spec of own) if (!rows.some(row => row.TRIGGER_NAME === spec[0])) missing.push(spec);
  if (required && missing.length) throw Error('Trigger outbox JIBAS belum lengkap atau tidak terlihat; periksa izin TRIGGER dan jalankan deploy.');
  return missing;
}

module.exports = {definitions, canonical, inspectTriggers};
