const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require("@whiskeysockets/baileys");
const express = require("express");
const fs = require("fs");
const mime = require("mime-types");
const qrcode = require("qrcode-terminal");
const path = require("path");
const { execFile } = require("child_process");

const APP_VERSION = 1.0;
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use("/", express.static("public"));

let dbType = "mysql";
let mysqlPool;
let oraclePool;
let mssqlPool;
let odbcPool;
let sqliteDb;

let isReady = false;
let isDbConnected = false;
let qrText = "";
let sock;

async function loadConfig() {
  try {
      const configStr = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
      return JSON.parse(configStr);
  } catch(e) {
      console.error("Gagal membaca config.json fallback.");
      return { delay: 10, db_type: 'sqlite', webhook_url: ''};
  }
}

async function initDatabase() {
    const config = await loadConfig();
    dbType = config.db_type ? config.db_type.toLowerCase() : "sqlite";

    try {
        if (dbType === "mysql") {
            const mysql = require("mysql2/promise");
            mysqlPool = mysql.createPool({
                host: config.host,
                user: config.user,
                password: config.password || "",
                database: config.database,
                charset: config.charset || "utf8mb4",
                timezone: config.timezone || "+07:00",
            });
            const c = await mysqlPool.getConnection(); // Test Koneksi
            c.release();
            isDbConnected = true;
            console.log("✅ Terhubung ke MySQL");
        } else if (dbType === "oracle") {
            const oracledb = require("oracledb");
            oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
            oracledb.autoCommit = true;
            oraclePool = await oracledb.createPool({
                user: config.user,
                password: config.password || "",
                connectString: `${config.host}/${config.database}`
            });
            isDbConnected = true;
            console.log("✅ Terhubung ke Oracle");
        } else if (dbType === "sqlserver") {
            const mssql = require("mssql");
            mssqlPool = await mssql.connect({
                user: config.user,
                password: config.password || "",
                server: config.host,
                database: config.database,
                options: { encrypt: false, trustServerCertificate: true }
            });
            isDbConnected = true;
            console.log("✅ Terhubung ke SQL Server");
        } else if (dbType === "odbc") {
            // Untuk ODBC, masukkan Connection String utuh ke kolom 'Host'
            const odbc = require("odbc");
            odbcPool = await odbc.pool(config.host);
            isDbConnected = true;
            console.log("✅ Terhubung ke ODBC");
        } else if (dbType === "sqlite") {
            const sqlite3 = require("sqlite3");
            const { open } = require("sqlite");
            sqliteDb = await open({
                filename: path.join(__dirname, 'wg.sqlite'),
                driver: sqlite3.Database
            });
            // Automatically execute Create Tables if tables do not exist
            const tableCheck = await sqliteDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'");
            if (!tableCheck) {
                console.log("⏳ Mengunggah Schema SQLite (Membuat Tabel)...");
                const schemaPath = path.join(__dirname, 'Create Tables - SQLLITE.sql');
                if (fs.existsSync(schemaPath)) {
                    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
                    await sqliteDb.exec(schemaSql);
                    console.log("✅ Schema SQLite berhasil dibuat.");
                } else {
                    console.error("❌ Schema SQLLITE.sql tidak ditemukan.");
                }
            }
            isDbConnected = true;
            console.log("✅ Terhubung ke SQLite (Lokal wg.sqlite)");
        }
    } catch (e) {
        console.error("❌ Error DB Connect:", e.message);
        isDbConnected = false;
    }
}

// Universal Query function
async function queryDB(sql, params = []) {
    try {
        if (dbType === "mysql") {
            const [rows] = await mysqlPool.execute(sql, params);
            return rows;
        } else if (dbType === "oracle") {
            // Oracle uses :1, :2, :3 instead of ?
            let orcSql = sql;
            let pId = 1;
            while(orcSql.includes("?")) {
                orcSql = orcSql.replace("?", `:${pId}`);
                pId++;
            }
            const result = await oraclePool.execute(orcSql, params);
            return result.rows || [];
        } else if (dbType === "sqlserver") {
            // mssql uses @p1, @p2, etc.
            let sqlSrvSql = sql;
            let pId = 1;
            const request = mssqlPool.request();
            while(sqlSrvSql.includes("?")) {
                let pName = `p${pId}`;
                sqlSrvSql = sqlSrvSql.replace("?", `@${pName}`);
                request.input(pName, params[pId-1]);
                pId++;
            }
            const result = await request.query(sqlSrvSql);
            return result.recordset || [];
        } else if (dbType === "odbc") {
            const result = await odbcPool.query(sql, params);
            return result || [];
        } else if (dbType === "sqlite") {
            if (!sqliteDb) throw new Error("SQLite disconnected");
            if (sql.trim().toUpperCase().startsWith("SELECT")) {
                 return await sqliteDb.all(sql, params);
            } else {
                 await sqliteDb.run(sql, params);
                 return [];
            }
        }
    } catch (e) {
        console.error("Gagal menjankan kueri DB:", e.message);
        const errStr = e.message.toLowerCase();
        if (errStr.includes("disconnect") || errStr.includes("close") || errStr.includes("socket") || errStr.includes("connection")) {
             console.log("Mencoba menyambung kembali ke Database (Network Reconnect)...");
             isDbConnected = false;
             initDatabase(); 
        }
        throw e;
    }
}

async function startSession() {
    if (!isDbConnected) await initDatabase();

    const { state, saveCreds } = await useMultiFileAuthState(`./sessions`);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        browser: ["WAGW PRO", "Desktop", "10.0"],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 20000,
        defaultQueryTimeoutMs: 60000,
        emitOwnEvents: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Koneksi ditutup. Reason:", lastDisconnect?.error?.message);
            isReady = false; 
            if (shouldReconnect) {
                console.log("Mencoba menyambung kembali dalam 5 detik...");
                setTimeout(startSession, 5000);
            }
            else console.log("🔒 Logout dari WhatsApp. Scan ulang QR diperlukan.");
        }

        if (connection === "open") {
            console.log("✅ Terhubung ke WhatsApp");
            qrText = "";
            isReady = true;
        }
        if (qr) {
            console.log("📲 Scan QR di Dashboard Web");
            qrcode.generate(qr, { small: true }); 
            qrText = qr;
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "notify") {
            for (const message of messages) {
                const isFromMe = message.key.fromMe;
                
                // Anti-ban: Auto-read (centang biru) pesan yang masuk untuk mensimulasikan user sungguhan
                if (!isFromMe && message.key.remoteJid !== 'status@broadcast') {
                    try { await sock.readMessages([message.key]); } catch(e){}
                }

                if (isFromMe) continue; 

                let fromNumber = message.key.remoteJid;
                if (fromNumber === 'status@broadcast') continue;

                if (fromNumber.endsWith('@s.whatsapp.net')) {
                    fromNumber = fromNumber.split('@')[0];
                    if (fromNumber.includes(':')) fromNumber = fromNumber.split(':')[0];
                }
                let messageText = "";

                if (message.message?.conversation) {
                    messageText = message.message.conversation;
                } else if (message.message?.extendedTextMessage?.text) {
                    messageText = message.message.extendedTextMessage.text;
                } else if (message.message?.imageMessage) {
                    messageText = message.message.imageMessage.caption || "[Image]";
                } else if (message.message?.documentMessage) {
                    messageText = message.message.documentMessage.fileName || "[Document]";
                } else if (message.message?.videoMessage) {
                    messageText = message.message.videoMessage.caption || "[Video]";
                } else {
                    messageText = "[Media/Unsupported]";
                }

                console.log(`📨 Pesan dari ${fromNumber}: ${messageText}`);
                try {
                    if (dbType === "oracle") {
                        await queryDB(`INSERT INTO inbox (wa_no, sub_no, wa_text, wa_time, status) VALUES (?, NULL, ?, CURRENT_TIMESTAMP, 'NEW')`, [fromNumber, messageText]);
                    } else {
                        await queryDB(`INSERT INTO inbox (wa_no, sub_no, wa_text, wa_time, status) VALUES (?, NULL, ?, CURRENT_TIMESTAMP, 'NEW')`, [fromNumber, messageText]);
                    }
                } catch(e) {
                   console.error("❌ Gagal simpan inbox:", e.message);
                }

                try {
                    const cfg = await loadConfig();
                    if(cfg.webhook_url) {
                        try {
                            await fetch(cfg.webhook_url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    wa_no: fromNumber,
                                    text: messageText,
                                    isMedia: messageText.includes("[Image]") || messageText.includes("[Document]")
                                })
                            }).catch(e=>{});
                        } catch(e) {
                            console.error("❌ Webhook fail:", e.message);
                        }
                    }
                    if(cfg.bot_exe) {
                        const idProfil = "0";
                        const exeArgs = [fromNumber + "~~" + messageText + "~~" + idProfil];
                        execFile(cfg.bot_exe, exeArgs, (err, stdout, stderr) => {
                            if(err) {
                                console.error("❌ Execute BOT EXE fail:", err.message);
                            } else {
                                console.log(`✅ BOT EXE executed: ${cfg.bot_exe}`);
                            }
                        });
                    }
                } catch(e) {
                    console.error("❌ Config load fail on incoming message:", e.message);
                }
            }
        }
    });

    initOutboxProcessor();
}


// --- REST APIS FOR DASHBOARD ---
app.get("/api/config", async (req, res) => {
    try {
        const config = await loadConfig();
        res.json(config);
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/test-db", async (req, res) => {
    try {
        const tempConfig = req.body;
        const testType = tempConfig.db_type ? tempConfig.db_type.toLowerCase() : "sqlite";
        
        if (testType === "mysql") {
            const mysql = require("mysql2/promise");
            const pool = mysql.createPool({
                host: tempConfig.host, user: tempConfig.user, password: tempConfig.password || "", database: tempConfig.database
            });
            const c = await pool.getConnection(); c.release(); await pool.end();
            return res.json({success: true, message: "✅ Koneksi MySQL Berhasil!"});
        } else if (testType === "oracle") {
            const oracledb = require("oracledb");
            const pool = await oracledb.createPool({
                user: tempConfig.user, password: tempConfig.password || "", connectString: `${tempConfig.host}/${tempConfig.database}`
            });
            await pool.close();
            return res.json({success: true, message: "✅ Koneksi Oracle Berhasil!"});
        } else if (testType === "sqlserver") {
            const mssql = require("mssql");
            const pool = await mssql.connect({
                user: tempConfig.user, password: tempConfig.password || "", server: tempConfig.host, database: tempConfig.database,
                options: { encrypt: false, trustServerCertificate: true }
            });
            await pool.close();
            return res.json({success: true, message: "✅ Koneksi SQL Server Berhasil!"});
        } else if (testType === "odbc") {
            const odbc = require("odbc");
            const pool = await odbc.pool(tempConfig.host); await pool.close();
            return res.json({success: true, message: "✅ Koneksi ODBC Berhasil!"});
        } else if (testType === "sqlite") {
            const sqlite3 = require("sqlite3");
            const { open } = require("sqlite");
            const tempDb = await open({
                filename: path.join(__dirname, 'wg.sqlite'),
                driver: sqlite3.Database
            });
            await tempDb.close();
            return res.json({success: true, message: "✅ Koneksi SQLite Lokal Berhasil!"});
        }
    } catch(e) {
        return res.json({success: false, error: e.message});
    }
});

app.post("/api/config", async (req, res) => {
    try {
        const configPath = path.join(__dirname, 'config.json');
        let oldConfig = {};
        try { oldConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e){}
        const newConfig = { ...oldConfig, ...req.body };
        // if user didn't enter pass, req.body doesn't have it, preserve oldConfig.password
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 4));
        
        // Auto apply new database connection
        await initDatabase();
        
        res.json({success: true, message: "Konfigurasi Database tersimpan dan sistem otomatis terhubung ke Database baru!"});
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/wa-control", async (req, res) => {
    try {
        const { action } = req.body;
        if (action === "start") {
            if(!sock) startSession();
            res.json({success: true, message: "Memulai sesi WhatsApp..."});
        } else if (action === "stop") {
            if(sock) { 
                sock.ws.close(); 
                sock = null; 
            }
            res.json({success: true, message: "Sesi WhatsApp dihentikan."});
        } else if (action === "restart") {
            if(sock) { 
                sock.ws.close(); 
                sock = null; 
            }
            setTimeout(startSession, 2000);
            res.json({success: true, message: "Merestart layanan WhatsApp..."});
        } else {
            res.status(400).json({error: "Unknown action"});
        }
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.get("/api/check-update", async (req, res) => {
    try {
        const resp = await fetch("https://wa-gw.com/update/version.json");
        const data = await resp.json();
        
        if (data.version > APP_VERSION) {
            res.json({ updateAvailable: true, current: APP_VERSION, latest: data.version, changelog: data.changelog || "", files: data.files });
        } else {
            res.json({ updateAvailable: false, current: APP_VERSION });
        }
    } catch(e) {
        res.status(500).json({error: "Gagal menyambung ke server update pusat."});
    }
});

app.post("/api/apply-update", async (req, res) => {
    try {
        const { files } = req.body;
        if (!files || !Array.isArray(files)) return res.status(400).json({error: "Data manifest pembaruan tidak valid"});
        
        let downloaded = 0;
        for (const fileDef of files) {
            if(!fileDef.url || !fileDef.dest) continue;
            try {
                const resp = await fetch(fileDef.url);
                if (!resp.ok) throw new Error("HTTP " + resp.status);
                
                const arrayBuf = await resp.arrayBuffer();
                const targetPath = path.join(__dirname, fileDef.dest);
                
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                
                fs.writeFileSync(targetPath, Buffer.from(arrayBuf));
                downloaded++;
            } catch(e) {
                console.error(`Gagal download update OTA ${fileDef.url}:`, e.message);
            }
        }
        
        res.json({success: true, message: `Pembaruan selesai (${downloaded} file dimuat ulang). Aplikasi akan re-start dalam 3 detik...`});
        
        setTimeout(() => {
            console.log("♻️ Memulai ulang WAGW PRO setelah update OTA...");
            process.exit(2);
        }, 3000);
        
    } catch(e) {
         res.status(500).json({error: e.message});
    }
});

app.get("/api/status", (req, res) => {
    res.json({
        ready: isReady,
        qr: qrText,
        dbConnected: isDbConnected,
        version: APP_VERSION
    });
});

app.post("/api/logout", async (req, res) => {
    try {
        if(sock) await sock.logout();
    } catch(e) {}
    try {
        fs.rmSync(path.join(__dirname, 'sessions'), { recursive: true, force: true });
    } catch(e) {}
    res.json({success: true, message: "Session WA dan folder session berhasil dihapus. Server akan memulai ulang otomatis."});
    
    // Matikan server setelah 2 detik agar background process mereset dirinya
    setTimeout(() => { process.exit(2); }, 2000);
});

app.get("/api/inbox", async (req, res) => {
    try {
        // limit fetching to 100 on dashboard
        const rows = await queryDB("SELECT * FROM inbox ORDER BY id DESC");
        // Oracle gives rows but since we do limit, it lacks standard limit if not written specifically
        // To be safe and cross database compatible, we just return all or handle on client if many
        res.json(rows.slice(0, 100)); // slice for safety
    } catch(e){ res.status(500).json({error: e.message}); }
});

app.get("/api/outbox", async (req, res) => {
    try {
        const rows = await queryDB("SELECT * FROM outbox ORDER BY id DESC");
        res.json(rows.slice(0, 100));
    } catch(e){ res.status(500).json({error: e.message}); }
});

app.get("/api/sent", async (req, res) => {
    try {
        const rows = await queryDB("SELECT * FROM sent ORDER BY wa_time DESC");
        res.json(rows.slice(0, 100));
    } catch(e){ res.status(500).json({error: e.message}); }
});

app.post("/api/send", async (req, res) => {
    try {
         const { no, text, media, file, filterOnline } = req.body;
         const jid = no.includes("@") ? no : `${no}@s.whatsapp.net`;
         
         let textVal = text || "";
         if(filterOnline) textVal = "[REQ_ONLINE]" + textVal;
         const mediaVal = media || null;
         const fileVal = file || null;

         await queryDB("INSERT INTO outbox (wa_no, wa_text, wa_media, wa_file) VALUES (?, ?, ?, ?)", [jid, textVal, mediaVal, fileVal]);
         res.json({ success: true, message: "Telah ditambahkan ke outbox" });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/clear-outbox", async (req, res) => {
     try {
         await queryDB("DELETE FROM outbox");
         res.json({success: true});
     } catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/api/clear-sent", async (req, res) => {
    try {
        await queryDB("DELETE FROM sent");
        res.json({success: true});
    } catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/api/check-number", async (req, res) => {
    try {
         if (!isReady || !sock) return res.status(400).json({ error: "Bot belum siap terhubung ke WA" });
         const { no } = req.body;
         if (!no) return res.status(400).json({ error: "Nomor diperlukan" });
         
         const nos = Array.isArray(no) ? no : no.split('\n').map(n => n.replace(/[^0-9@\.A-Za-z]/g, '').trim()).filter(n => n);
         let results = [];
         
         const processNos = nos.slice(0, 500); // safety cap
         for(let n of processNos) {
             const jid = n.includes("@") ? n : `${n}@s.whatsapp.net`;
             try {
                 const result = await sock.onWhatsApp(jid);
                 if (result && result.length > 0) {
                      results.push({ num: n, exists: result[0].exists, jid: result[0].jid });
                 } else {
                      results.push({ num: n, exists: false });
                 }
             } catch(err) {
                 results.push({ num: n, exists: false, error: err.message });
             }
             await new Promise(r => setTimeout(r, 100));
         }
         
         res.json({ success: true, results: results });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/send-bulk", async (req, res) => {
    try {
        const { messages, filterOnline } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({error: "Data pesan tidak valid"});
        
        let queued = 0;
        for(const msg of messages) {
            const no = msg.no;
            let text = msg.text || "";
            if(!no || !text) continue;
            if(filterOnline) text = "[REQ_ONLINE]" + text;
            const jid = no.includes("@") ? no : `${no}@s.whatsapp.net`;
            await queryDB("INSERT INTO outbox (wa_no, wa_text) VALUES (?, ?)", [jid, text]);
            queued++;
        }
        res.json({ success: true, message: `${queued} pesan berhasil dimasukkan ke antrean outbox.` });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/last-seen", async (req, res) => {
    try {
         if (!isReady || !sock) return res.status(400).json({ error: "Bot belum siap" });
         const { no } = req.body;
         if (!no) return res.status(400).json({ error: "Nomor diperlukan" });
         
         const jid = no.includes("@") ? no : `${no}@s.whatsapp.net`;
         let responseSent = false;
         
         const timeout = setTimeout(() => {
             if (!responseSent) {
                 responseSent = true;
                 sock.ev.off('presence.update', listener);
                 res.json({ success: false, error: "Timeout/Privasi dikunci oleh target." });
             }
         }, 8000);

         const listener = (event) => {
             if (event.id === jid) {
                  if (!responseSent) {
                      responseSent = true;
                      clearTimeout(timeout);
                      sock.ev.off('presence.update', listener);
                      const pres = event.presences[jid] || {};
                      res.json({ success: true, presence: pres.lastKnownPresence || 'unknown', lastSeen: pres.lastSeen || null });
                  }
             }
         };
         sock.ev.on('presence.update', listener);
         
         await sock.presenceSubscribe(jid);
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/profile-pic", async (req, res) => {
    try {
         if (!isReady || !sock) return res.status(400).json({ error: "Bot belum siap" });
         const { no } = req.body;
         const jid = no.includes("@") ? no : `${no}@s.whatsapp.net`;
         
         const url = await sock.profilePictureUrl(jid, 'image');
         if(url) res.json({ success: true, url: url });
         else res.json({ success: false, error: "Tidak ada foto profil."});
    } catch(e) {
        res.status(500).json({error: e.message}); // Usually means no profile pic or privacy restricted
    }
});

app.get("/api/get-groups", async (req, res) => {
    try {
        if (!isReady || !sock) return res.status(400).json({ error: "Bot belum siap" });
        const groupConfigs = await sock.groupFetchAllParticipating();
        const groups = Object.values(groupConfigs).map(g => ({
             id: g.id,
             subject: g.subject,
             participants_count: g.participants.length,
             participants: g.participants
        }));
        res.json({ success: true, groups: groups });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});


// OUTBOX PROCESSOR
let isProcessingOutbox = false;
let outboxSchedulerStarted = false;

async function safeSendMessage(jid, content) {
    if(!sock) return false;
    try {
        // Anti-ban: Mensimulasikan mengetik (Typing...) agar terlihat seperti manusia sungguhan
        await sock.sendPresenceUpdate('composing', jid);
        const typingDelayMs = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000); // Acak 1-2 detik
        await new Promise(resolve => setTimeout(resolve, typingDelayMs));
        await sock.sendPresenceUpdate('paused', jid);

        await sock.sendMessage(jid, content);
        return true; 
    } catch (err) {
        console.error("❌ Gagal kirim via socket:", err.message);
        return false;
    }
}

async function loopOutbox() {
    if(!isReady || isProcessingOutbox) return;
    isProcessingOutbox = true;

    try {
        const rows = await queryDB(`SELECT * FROM outbox`);
        
        if (rows && rows.length > 0) {
            // Sort to oldest first by id/time on code side to be DB-agnostic or depend on sequence
            const row = rows[0]; 
            const { id, wa_no, wa_text, wa_media, wa_file } = row;
            // Uppercase variants for Oracle compatibility (Oracle sometimes returns keys in uppercase)
            const idVal = row.id || row.ID;
            const waNoVal = wa_no || row.WA_NO;
            let waTextVal = wa_text || row.WA_TEXT;
            if (waTextVal) waTextVal = waTextVal.replace(/~r/g, "\n").replace(/<br>/gi, "\n");
            const waMediaVal = wa_media || row.WA_MEDIA;
            const waFileVal = wa_file || row.WA_FILE;

            const jid = waNoVal.includes("@") ? waNoVal : `${waNoVal}@s.whatsapp.net`;
            
            console.log(`🔍 Proses outbox ID ${idVal} ke ${waNoVal}`);

            let success = false;
            let status = "failed";

            try {
                if(waTextVal && waTextVal.startsWith("[REQ_ONLINE]")) {
                    waTextVal = waTextVal.substring(12);
                    console.log(`📡 Memeriksa status Online ${jid}...`);
                    
                    let targetIsOnline = false;
                    let waitFinished = false;
                    
                    const listener = (event) => {
                         if (event.id === jid) {
                              const pres = event.presences[jid] || {};
                              const lastSeenEpoch = pres.lastSeen || 0;
                              const nowEpoch = Math.floor(Date.now() / 1000);
                              
                              if (pres.lastKnownPresence === 'available' || pres.lastKnownPresence === 'composing') {
                                  targetIsOnline = true;
                              } else if (lastSeenEpoch > 0 && (nowEpoch - lastSeenEpoch) < 86400) {
                                  targetIsOnline = true;
                              }
                              waitFinished = true;
                         }
                    };
                    
                    sock.ev.on('presence.update', listener);
                    await sock.presenceSubscribe(jid);
                    
                    for(let i=0; i<30; i++) {
                        if(waitFinished) break;
                        await new Promise(r => setTimeout(r, 100)); // wait max 3s
                    }
                    sock.ev.off('presence.update', listener);
                    
                    if(!targetIsOnline) {
                        console.log(`🚫 Batal kirim ke ${jid}: Target Offline/Hidden > 24H`);
                        await queryDB(`DELETE FROM outbox WHERE id = ? OR ID = ?`, [idVal, idVal]);
                        await queryDB(`INSERT INTO sent (wa_no, wa_text, wa_time, status) VALUES (?, ?, ?, ?)`, [waNoVal, waTextVal.substring(0, 50) + " [CANCELLED: OFFLINE]", new Date(), "cancelled_offline"]);
                        isProcessingOutbox = false;
                        setTimeout(loopOutbox, 1000);
                        return;
                    }
                }

                if (waTextVal && waTextVal.startsWith("TEXTWITHBUTTON!") && !waMediaVal && !waFileVal) {
                    let cleanText = waTextVal.substring(15).trim();
                    const parts = cleanText.split("~").map(p => p.trim()).filter(p => p.length > 0);
                    if (parts.length >= 2) {
                         const caption = parts[0];
                         const templateButtons = [];
                         for (let i = 1; i < parts.length; i++) {
                             try {
                                 const btnConf = JSON.parse(parts[i]);
                                 // Basic template button structure for old baileys or fallback
                                 templateButtons.push({
                                     index: i,
                                     urlButton: {
                                         displayText: btnConf.buttonText?.displayText || "Link", 
                                         url: btnConf.url || "https://wa-gw.com" 
                                     } 
                                 });
                             } catch(e) {
                                 // fallback if not json
                                 templateButtons.push({
                                     index: i, urlButton: { displayText: parts[i], url: parts[i+1] || "https://wa-gw.com" }
                                 });
                                 i++; // skip next if it was url
                             }
                         }
                         if(templateButtons.length > 0) {
                            success = await safeSendMessage(jid, { 
                                text: caption, 
                                footer: "Info Tambahan", 
                                templateButtons: templateButtons
                            });
                         }
                    }
                } 
                else if (waTextVal && waTextVal.startsWith("POLLVOTE!") && !waMediaVal && !waFileVal) {
                     let cleanText = waTextVal.substring(9).trim();
                     cleanText = cleanText.replace(/^\:+/, "");
                     const parts = cleanText.split(":").map(p => p.trim()).filter(p => p.length > 0);
                     if(parts.length >= 3) {
                          const question = parts[0];
                          const options = parts.slice(1);
                          success = await safeSendMessage(jid, { poll: { name: question, values: options, selectableCount: 1 }});
                     }
                }
                else if (waMediaVal) {
                    let mediaPath = waMediaVal.replace(/\\\\/g,"/").replace(/\\/g,"/");
                    if (fs.existsSync(mediaPath)) {
                        const buffer = fs.readFileSync(mediaPath);
                        const mimetype = mime.lookup(mediaPath) || "image/jpeg";
                        success = await safeSendMessage(jid, { image: buffer, mimetype: mimetype, caption: waTextVal || "" });
                    }
                }
                else if (waFileVal) {
                     let filePath = waFileVal.replace(/\\\\/g,"/").replace(/\\/g,"/");
                     if (fs.existsSync(filePath)) {
                          const buffer = fs.readFileSync(filePath);
                          const mimetype = mime.lookup(filePath) || "application/octet-stream";
                          const fileName = filePath.split("/").pop() || "file.pdf";
                          success = await safeSendMessage(jid, { document: buffer, mimetype: mimetype, fileName });
                     }
                }
                else {
                     success = await safeSendMessage(jid, { text: waTextVal || "[Kosong]" });
                }

                if (success) {
                     status = "sent";
                     console.log(`✅ Text terkirim ID=${idVal}`);
                }
            } catch(e) {
                console.error("Gagal kirim data outbox", e.message);
            }

            try {
                // Sent table insert
                await queryDB(`INSERT INTO sent (id, wa_mode, wa_no, wa_text, wa_media, wa_file, wa_time, status) VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`, 
                    [idVal, waNoVal, waTextVal||"", waMediaVal||null, waFileVal||null, status]);
                
                await queryDB("DELETE FROM outbox WHERE id = ?", [idVal]);
            } catch (errMove) {
                 console.error("Gagal pindah ke sent:", errMove.message);
            }
        }
    } catch(errAll) {}

    isProcessingOutbox = false;
}

function initOutboxProcessor() {
     if (outboxSchedulerStarted) return;
     outboxSchedulerStarted = true;
     const checkLoop = async () => {
         await loopOutbox();
         const cfg = await loadConfig();
         let delayMs = (cfg.delay || 10) * 1000;
         setTimeout(checkLoop, delayMs);
     };
     console.log("📤 Scheduler Outbox Dimulai!");
     checkLoop();
}

app.post("/api/update-baileys", async (req, res) => {
    try {
        const { exec } = require("child_process");
        exec("npm update @whiskeysockets/baileys", { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Update Error: ${error.message}`);
                return res.status(500).json({ success: false, message: error.message });
            }
            res.json({ success: true, message: "Library berhasil diupdate!\n" + stdout });
        });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

loadConfig().then(config => {
    const port = config.port || 3000;
    app.listen(port, () => {
        console.log(`🚀 Server UI aktif di http://localhost:${port}`);
    });
}).catch(err => {
    app.listen(3000, () => {
        console.log(`🚀 Server UI aktif di http://localhost:3000 (Fallback)`);
    });
});

startSession();
