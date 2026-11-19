const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const express = require("express");
const fs = require("fs");
const mime = require("mime-types");
const path = require("path");
const QRCode = require("qrcode");
const { once } = require("node:events");
const { configFile, readConfig, dbType: readDbType, mysqlOptions, port, runtimeFlag } = require("./deployment/settings");
const { redactSessionLogs } = require("./deployment/session-logs");
const { dashboardAuth, readCredentials } = require("./deployment/dashboard-auth");

const APP_VERSION = require("./package.json").version;
const app = express();
let getJibasStatus;
let expectJibasWorker = false;
// Readiness probes never include a QR, credentials, or message contents.
app.get("/healthz", (_req, res) => {
    const jibas = getJibasStatus?.();
    const jibasReady = !!jibas && (!expectJibasWorker || jibas.workerRunning);
    res.status(isDbConnected && jibasReady ? 200 : 503).json({pid: process.pid, dbConnected: isDbConnected, jibasReady});
});
app.use(dashboardAuth({ https: runtimeFlag('DASHBOARD_HTTPS') }));
app.use((_req, res, next) => {
    res.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
});
app.use(["/api/check-update", "/api/apply-update", "/api/update-baileys"], (_req, res) =>
    res.status(403).json({error: "Gunakan paket rilis JIBAS WG dan installer untuk pembaruan."}));
app.use(express.json({ limit: "50mb" }));
app.use("/", express.static(path.join(__dirname, "public")));

let mysqlPool;
let mysqlTimezone;
const mysqlConnections = new WeakSet();
let activeConfig;
let sentStatusWidth = Infinity;

let isReady = false;
let isDbConnected = false;
let qrText = "";
let qrRevision = 0;
let sock;
let waState = "stopped";
let waWanted = false;
let waGeneration = 0;
let waStarting;
let waRetry;
let allowWhatsApp = true;
let stopping = false;
let makeSocket = makeWASocket;
let loadAuthState = useMultiFileAuthState;

function loadConfig() {
    return readConfig();
}

// Set the SQL session time zone before the first query on each pooled connection.
async function useMysqlConnection(operation) {
    const connection = await mysqlPool.getConnection();
    const identity = connection.connection || connection;
    try {
        if (!mysqlConnections.has(identity)) {
            await connection.query("SET SESSION time_zone=?", [mysqlTimezone]);
            mysqlConnections.add(identity);
        }
        return await operation(connection);
    } finally {
        connection.release();
    }
}

async function initDatabase(config = loadConfig()) {
    readDbType(config);
    try {
        const mysql = require("mysql2/promise");
        const opts = mysqlOptions(config);
        mysqlTimezone = opts.timezone;
        mysqlPool = mysql.createPool(opts);
        await useMysqlConnection(c => c.query("SELECT 1"));
        isDbConnected = true;
        console.log("✅ Terhubung ke MySQL");
    } catch (e) {
        await closeDatabase().catch(() => {});
        throw e;
    }
}

async function closeDatabase() {
    isDbConnected = false;
    if (!mysqlPool) return;
    const pool = mysqlPool;
    mysqlPool = undefined;
    await pool.end();
}

// JIBAS always runs on MySQL/MariaDB so queue transactions stay atomic.
async function queryDB(sql, params = []) {
    try {
        const [rows] = await useMysqlConnection(c => c.execute(sql, params));
        isDbConnected = true;
        return rows;
    } catch (e) {
        console.error("Gagal menjankan kueri DB:", e.message);
        if (/^(PROTOCOL_|ECONN|ETIMEDOUT|EPIPE|EHOST|ENET)/.test(e.code || '')) isDbConnected = false;
        throw e;
    }
}

function retrySession() {
    if (!waWanted || waRetry || stopping) return;
    waRetry = setTimeout(() => {
        waRetry = undefined;
        startSession();
    }, 5000);
}

function startSession() {
    if (stopping) return;
    waWanted = true;
    if (sock || waStarting || waRetry) return;
    const generation = waGeneration;
    waState = "connecting";
    waStarting = openSession(generation).catch(err => {
        if (generation !== waGeneration || !waWanted) return;
        console.error("Gagal memulai WhatsApp:", err.message);
        retrySession();
    }).finally(() => {
        waStarting = undefined;
        if (waWanted && generation !== waGeneration) startSession();
    });
}

function stopSession() {
    waWanted = false;
    waGeneration++;
    clearTimeout(waRetry);
    waRetry = undefined;
    const old = sock;
    sock = undefined;
    isReady = false;
    qrText = "";
    waState = "stopped";
    if (old) old.end(undefined);
}

async function openSession(generation) {
    const { state, saveCreds } = await loadAuthState(path.join(__dirname, 'sessions'));
    if (!waWanted || generation !== waGeneration || stopping) return;

    const socket = makeSocket({
        auth: state,
        browser: ["JIBAS WhatsApp Gateway", "Desktop", APP_VERSION],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 20000,
        defaultQueryTimeoutMs: 60000,
        emitOwnEvents: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
    });

    sock = socket;
    socket.ev.on("creds.update", () => {
        saveCreds().catch(err => console.error("Gagal menyimpan sesi WhatsApp:", err.message));
    });

    socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (socket !== sock) return;
        if (connection === "close") {
            sock = undefined;
            isReady = false;
            qrText = "";
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log("Koneksi ditutup. Reason:", lastDisconnect?.error?.message);
            if (code === DisconnectReason.connectionReplaced || code === DisconnectReason.loggedOut) {
                waWanted = false;
                waState = code === DisconnectReason.connectionReplaced ? "conflict" : "logged_out";
                console.error(waState === "conflict"
                    ? "Sesi WhatsApp digantikan koneksi lain. Hentikan instance duplikat lalu mulai ulang sesi."
                    : "Sesi WhatsApp tidak lagi tertaut. Tautkan ulang melalui dashboard.");
                return;
            }
            waState = "connecting";
            retrySession();
            return;
        }

        if (connection === "open") {
            console.log("✅ Terhubung ke WhatsApp");
            qrText = "";
            isReady = true;
            waState = "ready";
        }
        if (qr) {
            console.log("📲 Scan QR di Dashboard Web");
            qrText = qr;
            qrRevision++;
            waState = "qr";
        }
    });

}


// --- REST APIS FOR DASHBOARD ---
const databaseKeys = ["db_type", "host", "db_port", "database", "user", "password"];
const editableKeys = [...databaseKeys, "delay"];

function configCandidate(saved, fields = {}) {
    const candidate = { ...saved };
    for (const key of editableKeys) {
        if (Object.hasOwn(fields, key)) candidate[key] = fields[key];
    }
    if (getJibasStatus && candidate.database !== saved.database) throw Error("Schema gateway tidak dapat diganti dari dashboard.");
    candidate.db_type = readDbType(candidate);
    candidate.db_port = port(candidate.db_port, 3306, "db_port");
    // Do not forward a saved password to a different server, port or login.
    const sameLogin = readDbType(saved) === candidate.db_type &&
        candidate.host === saved.host && candidate.user === saved.user &&
        candidate.db_port === port(saved.db_port, 3306, "db_port");
    if (!sameLogin && !Object.hasOwn(fields, "password")) candidate.password = "";
    if (Object.hasOwn(fields, "delay")) {
        const delay = Number(fields.delay);
        if (!Number.isInteger(delay) || delay < 1 || delay > 86400) throw Error("Delay harus 1–86400 detik.");
        candidate.delay = delay;
    }
    return candidate;
}

function dbConfigChanged(before, after) {
    return databaseKeys.some(key => {
        if (key === "db_port") return Number(before.db_port ?? 3306) !== after.db_port;
        return (before[key] ?? "") !== (after[key] ?? "");
    });
}

async function testDatabase(config) {
    if (getJibasStatus) {
        const db = require("./deployment/database");
        const connection = await db.connect(db.config(config));
        try {
            const control = await db.assertRuntime(connection, config.database);
            if (Number(control.enabled) === 1) await db.assertCutover(connection, config.database);
        } finally {
            await connection.end();
        }
        return;
    }
    const mysql = require("mysql2/promise");
    const options = mysqlOptions(config);
    const connection = await mysql.createConnection(options);
    try {
        await connection.query("SET SESSION time_zone=?", [options.timezone]);
    } finally {
        await connection.end();
    }
}

app.get("/api/config", async (req, res) => {
    try {
        const { db_type, host, db_port, database, user, delay } = loadConfig();
        res.json({db_type, host, db_port, database, user, delay});
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/test-db", async (req, res) => {
    try {
        const config = configCandidate(loadConfig(), req.body);
        await testDatabase(config);
        return res.json({success: true, message: getJibasStatus
            ? "Koneksi MySQL/MariaDB dan schema bridge JIBAS berhasil diperiksa."
            : "Koneksi MySQL/MariaDB berhasil."});
    } catch(e) {
        return res.json({success: false, error: e.message});
    }
});

app.post("/api/config", async (req, res) => {
    try {
        const saved = loadConfig();
        const config = configCandidate(saved, req.body);
        if (dbConfigChanged(saved, config)) await testDatabase(config);
        // The running DB pool and its named lock must stay on the same DB until restart.
        const restartRequired = dbConfigChanged(activeConfig || saved, config);
        fs.writeFileSync(configFile, JSON.stringify(config, null, 4) + "\n", {mode: 0o600});
        res.json({success: true, restartRequired, message: restartRequired
            ? "Konfigurasi tersimpan. Restart aplikasi atau service untuk memakai koneksi database baru."
            : "Konfigurasi tersimpan."});
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/wa-control", async (req, res) => {
    try {
        const { action } = req.body;
        if (!allowWhatsApp && action !== "stop") {
            return res.status(503).json({error: "WhatsApp dinonaktifkan untuk pemeriksaan database."});
        }
        if (action === "start") {
            startSession();
            res.json({success: true, message: "Memulai sesi WhatsApp..."});
        } else if (action === "stop") {
            stopSession();
            res.json({success: true, message: "Sesi WhatsApp dihentikan."});
        } else if (action === "restart") {
            stopSession();
            startSession();
            res.json({success: true, message: "Merestart layanan WhatsApp..."});
        } else {
            res.status(400).json({error: "Unknown action"});
        }
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.get("/api/status", (req, res) => {
    res.json({
        ready: isReady,
        qr: qrText ? qrRevision : null,
        dbConnected: isDbConnected,
        whatsappState: waState,
        outboxPaused: !drainOutbox,
        jibas: getJibasStatus?.(),
        pid: process.pid,
        version: APP_VERSION
    });
});

app.get("/api/pairing-qr", async (_req, res) => {
    if (!qrText) return res.sendStatus(404);
    const svg = await QRCode.toString(qrText, {type: "svg", margin: 3, errorCorrectionLevel: "M"});
    res.type("image/svg+xml").send(svg);
});

app.post("/api/logout", async (req, res) => {
    if (!allowWhatsApp) return res.status(503).json({error: "WhatsApp dinonaktifkan untuk pemeriksaan database."});
    try {
        if(sock) await sock.logout();
    } catch(e) {}
    try {
        stopSession();
        fs.rmSync(path.join(__dirname, 'sessions'), { recursive: true, force: true });
        startSession();
        res.json({success: true, message: "Sesi WhatsApp dihapus. Pindai QR baru di dashboard."});
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.get("/api/inbox", async (req, res) => {
    try {
        const rows = await queryDB("SELECT * FROM inbox ORDER BY id DESC LIMIT 100");
        res.json(rows);
    } catch(e){ res.status(500).json({error: e.message}); }
});

app.get("/api/outbox", async (req, res) => {
    try {
        const rows = await queryDB("SELECT * FROM outbox ORDER BY id DESC LIMIT 100");
        res.json(rows);
    } catch(e){ res.status(500).json({error: e.message}); }
});

app.get("/api/sent", async (req, res) => {
    try {
        const rows = await queryDB("SELECT * FROM sent ORDER BY wa_time DESC LIMIT 100");
        res.json(rows);
    } catch(e){ res.status(500).json({error: e.message}); }
});

function testMessage({no, text, media, file} = {}, filterOnline = false) {
    if (media || file) throw Error("Uji dashboard hanya menerima teks, bukan path file server.");
    const number = typeof no === "string" ? no.trim() : "";
    const digits = number.replace(/^\+/, "").replace(/[\s()-]/g, "");
    let jid;
    if (/^\d{8,15}$/.test(digits)) {
        const normalized = digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("8") ? "62" + digits : digits;
        jid = `${normalized}@s.whatsapp.net`;
    } else if (/^(?:\d{8,20}@(?:s\.whatsapp\.net|lid)|\d+(?:-\d+)?@g\.us)$/.test(number)) {
        jid = number;
    } else {
        throw Error("Nomor atau JID WhatsApp tidak valid.");
    }
    const message = filterOnline ? "[REQ_ONLINE]" + text : text;
    if (typeof text !== "string" || !text.trim() || [...message].length > 2000) {
        throw Error('Teks pesan harus berisi 1–2000 karakter termasuk awalan opsional.');
    }
    return [jid, message];
}

app.post("/api/send", async (req, res) => {
    let entry;
    try { entry = testMessage(req.body, req.body?.filterOnline === true); }
    catch (err) { return res.status(400).json({error: err.message}); }
    try {
        const result = await queryDB("INSERT INTO outbox (wa_no, wa_text) VALUES (?, ?)", entry);
        res.json({ success: true, id: result?.insertId, message: "Pesan ditambahkan ke outbox." });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post(["/api/clear-outbox", "/api/clear-sent"], (_req, res) => {
    res.status(409).json({error: "Penghapusan massal dinonaktifkan agar antrean dan referensi audit JIBAS tidak hilang."});
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
    const { messages, filterOnline } = req.body || {};
    if (!Array.isArray(messages) || !messages.length || messages.length > 500) {
        return res.status(400).json({error: "Jumlah pesan harus 1–500."});
    }
    let entries;
    try { entries = messages.map(message => testMessage(message, filterOnline === true)); }
    catch (err) { return res.status(400).json({error: err.message}); }
    try {
        // Validate the whole batch before enqueueing; the MySQL batch is one statement.
        const placeholders = entries.map(() => "(?, ?)").join(", ");
        await queryDB(`INSERT INTO outbox (wa_no, wa_text) VALUES ${placeholders}`, entries.flat());
        res.json({ success: true, message: `${entries.length} pesan berhasil dimasukkan ke antrean outbox.` });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post("/api/last-seen", async (req, res) => {
    const socket = sock;
    if (!isReady || !socket) return res.status(400).json({error:"WhatsApp belum terhubung."});
    const no = req.body?.no;
    if (typeof no !== "string" || !no.trim()) return res.status(400).json({error:"Nomor diperlukan."});
    const jid = no.includes("@") ? no : `${no}@s.whatsapp.net`;
    let finished = false;
    const finish = data => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        socket.ev.off("presence.update", listener);
        if (data && !res.destroyed) res.json(data);
    };
    const listener = event => {
        if (event.id !== jid) return;
        const presence = event.presences?.[jid] || {};
        finish({success:true,presence:presence.lastKnownPresence || "unknown",lastSeen:presence.lastSeen || null});
    };
    const timeout = setTimeout(() => finish({success:false,error:"Timeout atau status tidak dibagikan."}), 8000);
    res.once("close", () => finish());
    socket.ev.on("presence.update", listener);
    try { await socket.presenceSubscribe(jid); }
    catch { finish({success:false,error:"Status WhatsApp tidak dapat diperiksa."}); }
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
let drainOutbox = true;
let outboxTimer;
let outboxWork;
let pendingReceipt;

async function safeSendMessage(jid, content) {
    const socket = sock;
    if (!isReady || !socket) return false;
    try {
        await socket.sendMessage(jid, content);
        return true;
    } catch (err) {
        console.error("❌ Gagal kirim via socket:", err.message);
        return false;
    }
}

async function recordOutbox(id, number, text, media, file, status) {
    const insert = "INSERT INTO sent (id, wa_mode, wa_no, wa_text, wa_media, wa_file, wa_time, status) VALUES (?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)";
    const params = [id, number, text || "", media || null, file || null, status];
    const remove = "DELETE FROM outbox WHERE id = ?";
    await useMysqlConnection(async connection => {
        await connection.beginTransaction();
        try {
            // If a previous COMMIT succeeded but its reply was lost, do not insert twice.
            const [[pending]] = await connection.execute("SELECT id FROM outbox WHERE id = ? FOR UPDATE", [id]);
            if (pending) {
                await connection.execute(insert, params);
                await connection.execute(remove, [id]);
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback().catch(() => {});
            throw err;
        }
    });
    return status;
}

async function persistReceipt(...receipt) {
    pendingReceipt = receipt;
    const status = await recordOutbox(...receipt);
    pendingReceipt = undefined;
    return status;
}

async function loopOutbox(onlyId) {
    if (stopping) return;
    try {
        if (pendingReceipt) return await persistReceipt(...pendingReceipt);
        if (!isReady) return;
        const rows = onlyId === undefined
            ? await queryDB("SELECT * FROM outbox ORDER BY id LIMIT 1")
            : await queryDB("SELECT * FROM outbox WHERE id = ?", [onlyId]);

        if (isReady && rows && rows.length > 0) {
            const row = rows[0];
            const { id: idVal, wa_no: waNoVal, wa_media: waMediaVal, wa_file: waFileVal } = row;
            let waTextVal = row.wa_text;
            if (waTextVal) waTextVal = waTextVal.replace(/~r/g, "\n").replace(/<br>/gi, "\n");

            const jid = waNoVal.includes("@") ? waNoVal : `${waNoVal}@s.whatsapp.net`;

            console.log(`🔍 Proses outbox ID ${idVal}`);

            let success = false;
            const failureStatus = sentStatusWidth >= 6 ? "failed" : "fail";
            let status = failureStatus;

            try {
                if(waTextVal && waTextVal.startsWith("[REQ_ONLINE]")) {
                    waTextVal = waTextVal.substring(12);
                    console.log(`📡 Memeriksa status Online ${jid}...`);

                    let targetIsOnline = false;
                    let waitFinished = false;

                     const socket = sock;
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

                     socket.ev.on('presence.update', listener);
                     try {
                         await socket.presenceSubscribe(jid);
                         for(let i=0; i<30; i++) {
                             if(waitFinished) break;
                             await new Promise(r => setTimeout(r, 100)); // wait max 3s
                         }
                     } finally {
                         socket.ev.off('presence.update', listener);
                     }
                     if (sock !== socket) return;

                    if(!targetIsOnline) {
                        console.log(`🚫 Batal kirim ke ${jid}: Target Offline/Hidden > 24H`);
                         const cancelled = sentStatusWidth >= 17 ? "cancelled_offline" : failureStatus;
                         return await persistReceipt(idVal, waNoVal, waTextVal.substring(0, 50) + " [CANCELLED: OFFLINE]", null, null, cancelled);
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
                                         url: btnConf.url
                                     }
                                 });
                             } catch(e) {
                                 // fallback if not json
                                 templateButtons.push({
                                      index: i, urlButton: { displayText: parts[i], url: parts[i+1] }
                                 });
                                 i++; // skip next if it was url
                             }
                         }
                          if (templateButtons.length && templateButtons.every(button => URL.canParse(button.urlButton.url) &&
                              ['https:', 'http:'].includes(new URL(button.urlButton.url).protocol))) {
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

             return await persistReceipt(idVal, waNoVal, waTextVal, waMediaVal, waFileVal, status);
        }
    } catch (err) {
        console.error("Gagal memproses outbox:", err.message);
        if (onlyId !== undefined) throw err;
    }
}

async function processOutbox(id) {
    if (outboxWork) return;
    outboxWork = loopOutbox(id);
    try { return await outboxWork; } finally { outboxWork = undefined; }
}

function scheduleOutbox() {
    if (!drainOutbox || stopping || outboxTimer) return;
    const tick = async () => {
        outboxTimer = undefined;
        await processOutbox();
        if (!stopping) scheduleOutbox();
    };
    let delay = 10;
    try {
        const value = Number(loadConfig().delay);
        if (value >= 1 && value <= 86400) delay = value;
    } catch {}
    outboxTimer = setTimeout(tick, delay * 1000);
}

async function startGateway(config, options = {}) {
    const uiPort = options.listenPort ?? port(
        runtimeFlag('DASHBOARD_HTTPS') ? config.backend_port ?? config.port : config.port, 3000, "port"
    );
    activeConfig = config;
    getJibasStatus = options.getJibasStatus;
    expectJibasWorker = options.expectJibasWorker === true;
    if (!readCredentials()) throw new Error("Kredensial dashboard belum tersedia. Jalankan installer JIBAS WG.");
    allowWhatsApp = options.whatsapp !== false;
    drainOutbox = options.drainOutbox !== false;
    makeSocket = options.makeSocket || makeWASocket;
    loadAuthState = options.loadAuthState || useMultiFileAuthState;
    sentStatusWidth = options.sentStatusWidth ?? Infinity;
    await initDatabase(config);
    const server = app.listen(uiPort, "127.0.0.1");
    try {
        await once(server, "listening");
    } catch (err) {
        await closeDatabase().catch(() => {});
        throw err;
    }
    console.log(`🚀 Server UI aktif di http://127.0.0.1:${server.address().port} (PID ${process.pid})`);
    waState = allowWhatsApp ? "connecting" : "disabled";
    if (allowWhatsApp) {
        redactSessionLogs(console);
        startSession();
    }
    scheduleOutbox();

    return {
        server,
        async close() {
            stopping = true;
            clearTimeout(outboxTimer);
            const httpClosed = new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
            try {
                await outboxWork;
            } finally {
                stopSession();
                await httpClosed;
                await closeDatabase();
            }
        },
        processQueuedMessage(id) {
            if (drainOutbox) throw new Error("Manual queue processing requires the automatic scheduler to be paused");
            if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid outbox ID");
            return processOutbox(id);
        }
    };
}

// Legacy portable and service launchers still use the guarded startup.
module.exports = { startGateway };
if (require.main === module) require("./deployment/start-gateway").run();
