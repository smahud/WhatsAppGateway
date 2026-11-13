document.addEventListener("DOMContentLoaded", () => {
    // Navigation Logic
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page-view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            pages.forEach(page => {
                page.classList.remove('active');
                if(page.id === targetId) {
                    page.classList.add('active');
                    loadPageData(targetId);
                }
            });
        });
    });

    // Default load EN
    if(typeof setLang === 'function') setLang('en');
    
    // Initial Load
    loadPageData('status-page');
    
    // Send Form
    document.getElementById('send-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
        
        try {
            const no = document.getElementById('send-no').value;
            const text = document.getElementById('send-text').value;
            const media = document.getElementById('send-media').value;
            const file = document.getElementById('send-file').value;
            
            const payload = {no};
            if(text) payload.text = text;
            if(media) payload.media = media;
            if(file) payload.file = file;
            if(document.getElementById('send-smart').checked) payload.filterOnline = true;

            const res = await fetch('/api/send', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if(data.success) {
                alert("Pesan masuk ke Outbox!");
                document.getElementById('send-text').value = '';
            } else {
                alert("Error: " + data.error);
            }
        } catch(err) {
            alert("Connection error.");
        }
        btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send to Outbox`;
    });

    // Bulk Send Form
    document.getElementById('bulk-send-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const resultDiv = document.getElementById('bulk-result');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Merakit & Memasukkan ke Antrean...`;
        btn.disabled = true;
        resultDiv.innerText = '';
        
        try {
            const rawData = document.getElementById('bulk-data').value;
            const templateText = document.getElementById('bulk-text').value;
            
            const lines = rawData.split('\n').map(l => l.trim()).filter(l => l);
            let finalPayloadBatch = [];
            
            for(const line of lines) {
                // assume separated by tab or pipe or comma
                let columns = line.split(/[\t|]+/).map(c => c.trim());
                if (columns.length === 1 && line.includes(',')) {
                     columns = line.split(',').map(c => c.trim());
                }
                
                const no = columns[0].replace(/[^0-9@\.A-Za-z_-]/g, '');
                if(!no) continue;
                
                let personalizedText = templateText;
                for(let i = 0; i < columns.length; i++) {
                     // {1} for col[0], {2} for col[1] ... Wait, users usually expect {1} to be the FIRST variable, maybe the Name, but let's just say {1} = col0, {2} = col1
                     const regex = new RegExp(`\\{${i+1}\\}`, 'g');
                     personalizedText = personalizedText.replace(regex, columns[i]);
                }
                
                finalPayloadBatch.push({ no: no, text: personalizedText });
            }
            
            if(finalPayloadBatch.length === 0) {
                 resultDiv.innerHTML = `<span style="color:var(--danger)">Data tidak valid/kosong.</span>`;
                 btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Blast Bulk to Outbox`;
                 btn.disabled = false;
                 return;
            }

            const payload = { messages: finalPayloadBatch };
            if(document.getElementById('bulk-smart').checked) payload.filterOnline = true;

            const res = await fetch('/api/send-bulk', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if(data.success) {
                resultDiv.innerHTML = `<i class="fa-solid fa-check"></i> ${data.message} (${finalPayloadBatch.length} Nomor diproses)`;
            } else {
                resultDiv.innerHTML = `<span style="color:var(--danger)">Error: ${data.error}</span>`;
            }
        } catch(err) {
            resultDiv.innerHTML = `<span style="color:var(--danger)">Connection error.</span>`;
        }
        
        btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Blast Bulk to Outbox`;
        btn.disabled = false;
    });

    // Config form
    document.getElementById('config-form').addEventListener('submit', async(e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
        
        const payload = {
            db_type: document.getElementById('cfg-db_type').value,
            host: document.getElementById('cfg-host').value,
            database: document.getElementById('cfg-db').value,
            user: document.getElementById('cfg-user').value,
            delay: parseInt(document.getElementById('cfg-delay').value),
            webhook_url: document.getElementById('cfg-webhook').value,
            bot_exe: document.getElementById('cfg-botexe').value
        };
        const pass = document.getElementById('cfg-pass').value;
        if(pass) payload.password = pass;

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if(data.success) alert("Saved! " + data.message);
            else alert("Error: " + data.error);
        } catch(err) {
             alert("Connection error.");
        }
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Configuration`;
    });

    // We'll define testDBConnection function lower down or just here outside DOMContentLoaded but since we need it globally it should be outside or accessible.
    // Ah, DOMContentLoaded is wrapping this whole thing, so it shouldn't be defined with `function testDBConnection()` inside if we want it accessible from HTML inline handlers `onclick="testDBConnection()"`... Wait, `testDBConnection` should be attached to `window`.

    // Check Number form
    document.getElementById('check-num-form')?.addEventListener('submit', async(e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const resDiv = document.getElementById('check-result');
        const btnCopy = document.getElementById('btn-copy-check');
        const no = document.getElementById('check-no').value;
        
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa...`;
        resDiv.style.display = 'none';
        btnCopy.style.display = 'none';
        window._latestCheckResults = "";
        
        try {
            const res = await fetch('/api/check-number', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({no})
            });
            const data = await res.json();
            
            resDiv.style.display = 'block';
            if(data.success && data.results) {
                let htmlOut = ``;
                let rawCopy = ``;
                
                data.results.forEach(r => {
                    if(r.exists) {
                        htmlOut += `<div style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);"><i class="fa-solid fa-check-circle" style="color:var(--success)"></i> <b>${r.num}</b> - Terdaftar (JID: ${r.jid})</div>`;
                        rawCopy += `${r.num}\tTerdaftar\t${r.jid}\n`;
                    } else if(r.error) {
                        htmlOut += `<div style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);"><i class="fa-solid fa-triangle-exclamation" style="color:#f39c12"></i> <b>${r.num}</b> - Error: ${r.error}</div>`;
                        rawCopy += `${r.num}\tError\t${r.error}\n`;
                    } else {
                        htmlOut += `<div style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);"><i class="fa-solid fa-circle-xmark" style="color:var(--danger)"></i> <b>${r.num}</b> - TIDAK Terdaftar</div>`;
                        rawCopy += `${r.num}\tTIDAK Terdaftar\t-\n`;
                    }
                });
                
                resDiv.innerHTML = htmlOut;
                resDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
                resDiv.style.border = '1px solid #333';
                window._latestCheckResults = rawCopy;
                if(data.results.length > 0) btnCopy.style.display = 'inline-block';
                
            } else {
                resDiv.innerHTML = `<strong>Error:</strong> ${data.error || 'Server error'}`;
                resDiv.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                resDiv.style.border = '1px solid var(--danger)';
            }
        } catch(err) {
             alert("Connection error.");
        }
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Cek Status`;
    });

    // Last Seen Form
    document.getElementById('check-last-form').addEventListener('submit', async(e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const resDiv = document.getElementById('last-result');
        const no = document.getElementById('last-no').value;
        
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengintai...`;
        btn.disabled = true;
        resDiv.style.display = 'block';
        resDiv.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> Menunggu balasan Server Meta... (Max 8d)`;
        
        try {
            const res = await fetch('/api/last-seen', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({no})
            });
            const data = await res.json();
            if(data.success) {
                resDiv.innerHTML = `<strong>Status:</strong> ${data.presence}<br><strong>Terakhir Dilihat:</strong> ${data.lastSeen ? new Date(data.lastSeen*1000).toLocaleString() : 'Disembunyikan target'}`;
                resDiv.style.color = "var(--success)";
            } else {
                resDiv.innerHTML = `<span style="color:var(--danger)">Error: ${data.error}</span>`;
            }
        } catch(e) {
            resDiv.innerHTML = `<span style="color:var(--danger)">Connection Timeout.</span>`;
        }
        btn.innerHTML = `<i class="fa-solid fa-clock"></i> Intai Status`;
        btn.disabled = false;
    });

    // Profile Pic Form
    document.getElementById('check-pic-form').addEventListener('submit', async(e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const resDiv = document.getElementById('pic-result');
        const no = document.getElementById('pic-no').value;
        
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menarik...`;
        btn.disabled = true;
        resDiv.style.display = 'block';
        resDiv.innerHTML = 'Memuat...';
        
        try {
            const res = await fetch('/api/profile-pic', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({no})
            });
            const data = await res.json();
            if(data.success) {
                resDiv.innerHTML = `<img src="${data.url}" style="max-width:150px; border-radius:50%; border:3px solid #1abc9c;"><br>Berhasil ditarik.`;
            } else {
                resDiv.innerHTML = `<span style="color:var(--danger)">Error/Privasi: ${data.error}</span>`;
            }
        } catch(e) {
            resDiv.innerHTML = `<span style="color:var(--danger)">Connection Error.</span>`;
        }
        btn.innerHTML = `<i class="fa-solid fa-camera"></i> Tarik Foto Profil`;
        btn.disabled = false;
    });
    // Group Fetcher Form
    document.getElementById('check-group-form').addEventListener('submit', async(e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const resDiv = document.getElementById('group-result');
        const btnCopy = document.getElementById('btn-copy-group');
        
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menarik...`;
        btn.disabled = true;
        resDiv.style.display = 'block';
        resDiv.innerHTML = 'Memuat list grup dari WhatsApp Meta...';
        btnCopy.style.display = 'none';
        
        try {
            const res = await fetch('/api/get-groups');
            const data = await res.json();
            if(data.success) {
                if(data.groups.length === 0) {
                     resDiv.innerHTML = "Tidak ada grup yang Anda ikuti saat ini.";
                } else {
                     let html = `<b>Ditemukan ${data.groups.length} Grup:</b><br><br>`;
                     let raw = "";
                     window._latestGroupData = {};
                     data.groups.forEach(g => {
                         window._latestGroupData[g.id] = g.participants;
                         html += `<div><strong>${g.subject}</strong><br><span style="color:#2ecc71;">ID:</span> <code>${g.id}</code> (${g.participants_count} anggota)<br><button type="button" class="btn btn-secondary" style="padding:2px 8px; font-size:0.75rem; margin-top:5px; margin-bottom:5px;" onclick="viewGroupMembers('${g.id}', '${g.subject.replace(/'/g, "\\'")}')"><i class="fa-solid fa-address-book"></i> Lihat List Member</button></div><hr style="border-color:#333">`;
                         raw += `${g.id}\n`;
                     });
                     resDiv.innerHTML = html;
                     window._latestGroupResults = raw;
                     btnCopy.style.display = 'inline-block';
                }
            } else {
                resDiv.innerHTML = `<span style="color:var(--danger)">Error: ${data.error}</span>`;
            }
        } catch(e) {
            resDiv.innerHTML = `<span style="color:var(--danger)">Connection Error.</span>`;
        }
        btn.innerHTML = `<i class="fa-solid fa-download"></i> Ambil List Grup`;
        btn.disabled = false;
    });
});

function importCSV(event) {
    const file = event.target.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        // Optionally detect if first line is a header by trying to match numbers
        const lines = text.split('\n');
        if(lines.length > 0 && !/\d{8}/.test(lines[0])) {
            // First line might be header, let's just let user delete it themselves to be safe
            // or we keep it. The backend filters non-numbers anyway.
        }
        document.getElementById('bulk-data').value = text;
        alert('File berhasil dibaca & di-load ke dalam textarea. Pastikan kolom Anda sudah sesuai!');
    };
    reader.readAsText(file);
}

function copyCheckResults() {
    if(window._latestCheckResults) {
        navigator.clipboard.writeText(window._latestCheckResults).then(() => {
            const btn = document.getElementById('btn-copy-check');
            const oldHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Tersalin!`;
            btn.className = "btn btn-success ms-2";
            setTimeout(() => {
                btn.innerHTML = oldHtml;
                btn.className = "btn btn-secondary ms-2";
            }, 2000);
        });
    }
}

function copyGroupResults() {
    if(window._latestGroupResults) {
        navigator.clipboard.writeText(window._latestGroupResults).then(() => {
            const btn = document.getElementById('btn-copy-group');
            const oldHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Tersalin!`;
            btn.className = "btn btn-success ms-2";
            setTimeout(() => {
                btn.innerHTML = oldHtml;
                btn.className = "btn btn-secondary ms-2";
            }, 2000);
        });
    }
}

function viewGroupMembers(id, subject) {
    if(!window._latestGroupData || !window._latestGroupData[id]) return;
    const parts = window._latestGroupData[id];
    let listContent = `<div style="margin-bottom:10px;"><button class="btn btn-primary" style="font-size:0.8rem; padding:4px 8px;" onclick="copyGroupMembers('${id}')"><i class="fa-solid fa-copy"></i> Salin Semua Nomor</button></div>`;
    parts.forEach(p => {
        let no = p.id.split('@')[0];
        let role = p.admin ? ` <span style="background:var(--primary); color:#fff; padding:1px 5px; border-radius:3px; font-size:0.7rem;">${p.admin}</span>` : "";
        listContent += `<div style="padding:3px 0; border-bottom:1px dashed #444;">${no}${role}</div>`;
    });
    
    document.getElementById('msgModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
    document.querySelector('#msgModal h3').innerHTML = `Anggota: ${subject}`;
    document.getElementById('msgModalBody').innerHTML = listContent;
}

function copyGroupMembers(id) {
    if(!window._latestGroupData || !window._latestGroupData[id]) return;
    const texts = window._latestGroupData[id].map(p => p.id.split('@')[0]).join('\n');
    navigator.clipboard.writeText(texts).then(() => {
        alert("Semua nomor tersalin ke Clipboard!");
    });
}

function toggleSendMode(mode) {
    const btnSingle = document.getElementById('btn-tab-single');
    const btnBulk = document.getElementById('btn-tab-bulk');
    const frmSingle = document.getElementById('send-form');
    const frmBulk = document.getElementById('bulk-send-form');
    
    if(mode === 'single') {
        btnSingle.className = "btn btn-primary";
        btnBulk.className = "btn btn-secondary";
        frmSingle.style.display = "block";
        frmBulk.style.display = "none";
    } else {
        btnBulk.className = "btn btn-primary";
        btnSingle.className = "btn btn-secondary";
        frmBulk.style.display = "block";
        frmSingle.style.display = "none";
    }
}

function loadPageData(pageId) {
    if(pageId === 'status-page') loadStatus();
    else if(pageId === 'config-page') loadConfig();
    else if(pageId === 'inbox-page') loadInbox();
    else if(pageId === 'outbox-page') loadOutbox();
    else if(pageId === 'sent-page') loadSent();
}

async function loadStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        const ind = document.querySelector('.dot');
        const txt = document.getElementById('conn-text');
        const qrBox = document.getElementById('qr-container');
        const verBadge = document.getElementById('app-ver-badge');
        
        if (verBadge && data.version) verBadge.innerText = `Ver ${data.version}`;

        if(data.dbConnected === false) {
             ind.className = "dot disconnected";
             txt.innerText = "Database Error";
             qrBox.innerHTML = `
                <div style="color:var(--danger); text-align:center;">
                    <i class="fa-solid fa-database" style="font-size:3rem; margin-bottom:10px;"></i>
                    <i class="fa-solid fa-xmark" style="font-size:1.5rem; margin-left:-15px;"></i>
                    <h3 style="margin:10px 0;">Koneksi Database Gagal!</h3>
                    <p style="font-size:0.9rem">Sistem tidak dapat terhubung ke basis data SQL Anda.</p>
                    <p style="font-size:0.9rem">Mohon periksa kembali Username & Password di Tab <b>Config</b>.</p>
                </div>
             `;
             return; // Stop rendering whatsapp status if DB is dead
        }

        if(data.ready) {
            ind.className = "dot connected";
            txt.innerText = "Connected to WhatsApp";
            qrBox.innerHTML = '<p style="color:var(--success)"><i class="fa-solid fa-check-circle" style="font-size:3rem"></i><br><br>Device is connected and ready.</p>';
        } else {
            ind.className = "dot disconnected";
            txt.innerText = "Disconnected";
            if(data.qr) {
                qrBox.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;">
                        <div id="qrcode_canvas" style="background:white;padding:15px;border-radius:10px;"></div>
                        <p style="margin-top:15px">Silakan scan QR Code ini dari Aplikasi WhatsApp Anda (Tautkan Perangkat)</p>
                    </div>`;
                new QRCode(document.getElementById("qrcode_canvas"), {
                    text: data.qr,
                    width: 250,
                    height: 250
                });
            } else {
                qrBox.innerHTML = '<p>Loading connection state...</p>';
            }
        }
    } catch(e) { }
}

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        document.getElementById('cfg-db_type').value = data.db_type || 'mysql';
        document.getElementById('cfg-host').value = data.host || '';
        document.getElementById('cfg-db').value = data.database || '';
        document.getElementById('cfg-user').value = data.user || '';
        document.getElementById('cfg-delay').value = data.delay || 10;
        document.getElementById('cfg-webhook').value = data.webhook_url || '';
        document.getElementById('cfg-botexe').value = data.bot_exe || '';
        if(typeof updateDBHelp === 'function') updateDBHelp();
    } catch(e) {}
}

async function loadInbox() {
    try {
        const res = await fetch('/api/inbox');
        const data = await res.json();
        const tb = document.getElementById('inbox-body');
        tb.innerHTML = '';
        data.forEach(r => {
            const id = r.id || r.ID;
            const no = r.wa_no || r.WA_NO || '-';
            const text = (r.wa_text || r.WA_TEXT || '').substring(0, 50) + '...';
            const time = r.wa_time || r.WA_TIME || '-';
            tb.innerHTML += `<tr><td>${id}</td><td>${no}</td><td>${text}</td><td>${time}</td></tr>`;
        });
        if(data.length === 0) tb.innerHTML = '<tr><td colspan="4">Inbox is empty.</td></tr>';
    } catch(e){}
}

async function loadOutbox() {
    try {
        const res = await fetch('/api/outbox');
        window._outboxData = await res.json();
        const data = window._outboxData;
        const tb = document.getElementById('outbox-body');
        tb.innerHTML = '';
        data.forEach((r, idx) => {
            const id = r.id || r.ID;
            const time = r.wa_time || r.WA_TIME || 'Pending';
            const no = r.wa_no || r.WA_NO || '-';
            const rawText = r.wa_text || r.WA_TEXT || '';
            let text = rawText.substring(0, 40);
            if(rawText.length > 40 || r.wa_media || r.wa_file) text += '... (Click to view)';
            tb.innerHTML += `<tr style="cursor:pointer;" onclick="showMsgDetail(${idx}, 'outbox')">
                <td>${id}</td>
                <td>${time}</td>
                <td>${no}</td>
                <td><span style="color:#3498db">${text}</span></td>
            </tr>`;
        });
        if(data.length === 0) tb.innerHTML = '<tr><td colspan="4" data-t="msg_empty">Outbox is empty.</td></tr>';
    } catch(e){}
}
async function updateBaileys() {
    const btn = document.getElementById('btn-update');
    const oriText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating (Harap Tunggu)...`;
    btn.disabled = true;

    try {
        const res = await fetch('/api/update-baileys', { method: 'POST' });
        const data = await res.json();
        if(data.success) {
            alert("Pembaruan Selesai!\n\n" + data.message + "\n\nHarap klik tombol STOP.bat lalu START.bat kembali agar WAGW menelan versi baru.");
        } else {
            alert("Gagal melakukan Pembaruan: \n" + data.message);
        }
    } catch(e) {
        alert("Koneksi gagal atau Proses terlalu lama.");
    }

    btn.innerHTML = oriText;
    btn.disabled = false;
}

window._latestOTA = null;

async function checkAppUpdate() {
    const btn = document.getElementById('btn-ota-check');
    const box = document.getElementById('ota-result-box');
    const oriText = btn.innerHTML;
    
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Server...`;
    btn.disabled = true;
    box.style.display = 'none';

    try {
        const res = await fetch('/api/check-update');
        const data = await res.json();
        
        box.style.display = 'block';
        if(data.updateAvailable) {
            window._latestOTA = data.files;
            box.style.border = '1px solid var(--success)';
            box.innerHTML = `
                <div style="color:var(--success); margin-bottom:10px;"><strong><i class="fa-solid fa-bolt"></i> Update OTA Tersedia! (Ver ${data.latest})</strong></div>
                <div>Versi saat ini: ${data.current}</div>
                <div style="margin:5px 0; color:#ccc;"><em>"${data.changelog}"</em></div>
                <button class="btn btn-success" style="width:100%; margin-top:10px;" onclick="applyAppUpdate()"><i class="fa-solid fa-download"></i> Terapkan Update (Auto Restart)</button>
            `;
        } else if (data.error) {
            box.style.border = '1px solid var(--danger)';
            box.innerHTML = `<span style="color:var(--danger)">Error: ${data.error}</span>`;
        } else {
            box.style.border = '1px solid #444';
            box.innerHTML = `<span style="color:#aaa"><i class="fa-solid fa-check"></i> WAGW PRO Anda sudah versi paling mutakhir (Ver ${data.current}).</span>`;
        }
    } catch(e) {
        box.style.display = 'block';
        box.innerHTML = `<span style="color:var(--danger)">Koneksi ke Server wa-gw.com gagal.</span>`;
    }

    btn.innerHTML = oriText;
    btn.disabled = false;
}

async function applyAppUpdate() {
    if(!window._latestOTA) return;
    if(!confirm("Proses ini akan menimpa file lokal dan merestart mesin bot WAGW secara otomatis. Lanjutkan?")) return;
    
    const box = document.getElementById('ota-result-box');
    box.innerHTML = `<div style="text-align:center; padding:10px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Mengunduh & menerapkan file pembaruan...<br>Jangan tutup layar ini.</div>`;
    
    try {
        const res = await fetch('/api/apply-update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({files: window._latestOTA})
        });
        const data = await res.json();
        
        if(data.success) {
            box.innerHTML = `<div style="color:var(--success); text-align:center; padding:10px;"><i class="fa-solid fa-check-circle fa-2x"></i><br><br>${data.message}</div>`;
            setTimeout(() => {
                window.location.reload();
            }, 4000);
        } else {
            box.innerHTML = `<div style="color:var(--danger)">Gagal Menerapkan Update: ${data.error}</div>`;
        }
    } catch(e) {
        box.innerHTML = `<div style="color:var(--danger)">Proses Update Timeout/Error. Silakan restart program secara manual.</div>`;
    }
}
async function loadSent() {
    try {
        const res = await fetch('/api/sent');
        window._sentData = await res.json();
        const data = window._sentData;
        const tb = document.getElementById('sent-body');
        tb.innerHTML = '';
        data.forEach((r, idx) => {
            const id = r.id || r.ID;
            const no = r.wa_no || r.WA_NO || '-';
            const time = r.wa_time || r.WA_TIME || '-';
            const rawText = r.wa_text || r.WA_TEXT || '';
            let text = rawText.substring(0, 40);
            if(rawText.length > 40 || r.wa_media || r.wa_file) text += '... (Click to view)';
            const status = r.status || r.STATUS || 'unknown';
            tb.innerHTML += `<tr style="cursor:pointer;" onclick="showMsgDetail(${idx}, 'sent')">
                <td>${id}</td>
                <td>${time}</td>
                <td>${no}</td>
                <td><span style="color:#3498db">${text}</span></td>
                <td>${status}</td>
            </tr>`;
        });
        if(data.length === 0) tb.innerHTML = '<tr><td colspan="5" data-t="msg_empty">Sent box is empty.</td></tr>';
    } catch(e){}
}

async function clearOutbox() {
    if(!confirm("Hapus semua antrean outbox?")) return;
    await fetch('/api/clear-outbox', {method: 'POST'});
    loadOutbox();
}

async function clearSent() {
    if(!confirm("Hapus history sent?")) return;
    await fetch('/api/clear-sent', {method: 'POST'});
    loadSent();
}

async function logoutSession() {
    if(!confirm("Yakin ingin melakukan Log Out sistem WhatsApp dan membersihkan semua Session? Aplikasi akan ter-reset.")) return;
    
    try {
        const res = await fetch('/api/logout', {method: 'POST'});
        const data = await res.json();
        alert(data.message);
        // Arahkan user untuk merestart (Service Windows mematikan dirinya otomatis, jd mungkin web lgsg putus)
    } catch(e) {}
}

function showMsgDetail(idx, type) {
    const dataRow = type === 'outbox' ? window._outboxData[idx] : window._sentData[idx];
    if(!dataRow) return;
    const text = dataRow.wa_text || dataRow.WA_TEXT || '[No text]';
    const media = dataRow.wa_media || dataRow.WA_MEDIA || '';
    const file = dataRow.wa_file || dataRow.WA_FILE || '';
    
    let out = `<b>Pesan/Text:</b><br/>${text.replace(/\n/g, '<br/>')}`;
    if(media) out += `<br/><br/><b>Media Attachment:</b><br/>${media}`;
    if(file) out += `<br/><br/><b>File Attachment:</b><br/>${file}`;
    
    document.getElementById('msgModalBody').innerHTML = out;
    document.getElementById('msgModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
}

const UI_DICT = {
    "en": {
        "th_time": "Time", "th_receiver": "Receiver", "th_text": "Text", "th_status": "Status",
        "btn_check": "Check Status", "btn_close": "Close", "modal_title": "Message Detail",
        "msg_empty": "Table is empty.", "btn_logout": "Logout WA (Clear Session)",
        "nav_status": "Status", "nav_config": "Config", "nav_send": "Send Message", "nav_inbox": "Inbox", "nav_outbox": "Outbox", "nav_sent": "Sent", "nav_tools": "Tools",
        "hs_status": "System Status", "p_status": "Monitor your WhatsApp connection state.",
        "hs_config": "Configuration", "p_config": "Set up database connection and system parameters.",
        "hs_send": "Send Message", "p_send": "Draft and send quick messages directly into the outbox.",
        "hs_inbox": "Inbox Messages", "p_inbox": "Live monitor of incoming messages.",
        "hs_outbox": "Outbox Queue", "p_outbox": "Pending messages waiting to be sent.",
        "hs_sent": "Sent History", "p_sent": "Successfully processed messages.",
        "hs_tools": "Tools & Utilities", "p_tools": "Check WhatsApp number availability."
    },
    "id": {
        "th_time": "Waktu", "th_receiver": "Penerima", "th_text": "Isi Pesan", "th_status": "Status",
        "btn_check": "Periksa Status", "btn_close": "Tutup", "modal_title": "Detail Baris Pesan",
        "msg_empty": "Tabel ini kosong.", "btn_logout": "Keluar WA (Hapus Sesi)",
        "nav_status": "Status Sistem", "nav_config": "Pengaturan", "nav_send": "Kirim Pesan", "nav_inbox": "Kotak Masuk", "nav_outbox": "Kotak Keluar", "nav_sent": "Terkirim", "nav_tools": "Alat Lain",
        "hs_status": "Status Server", "p_status": "Pantau koneksi WhatsApp Anda secara langsung.",
        "hs_config": "Pengaturan Sistem", "p_config": "Atur kredensial database dan parameter bot.",
        "hs_send": "Kirim Cepat", "p_send": "Masukkan pesan ke antrean secara manual dari web.",
        "hs_inbox": "Pesan Masuk", "p_inbox": "Riwayat chat WhatsApp yang diterima server.",
        "hs_outbox": "Antrean Keluar", "p_outbox": "Pesan tertahan yang dijadwalkan untuk dikirim.",
        "hs_sent": "Pesan Terkirim", "p_sent": "Riwayat pesan yang sukses diluncurkan.",
        "hs_tools": "Peralatan", "p_tools": "Lakukan cek apakah suatu nomor terdaftar di WA."
    }
};

function setLang(lang) {
    document.querySelectorAll('[data-t]').forEach(el => {
        const key = el.getAttribute('data-t');
        if(UI_DICT[lang] && UI_DICT[lang][key]) el.innerHTML = UI_DICT[lang][key];
    });
    const len = document.getElementById('l-en');
    const lid = document.getElementById('l-id');
    if(len && lid) {
        if(lang === 'en') { len.style.color = '#2ecc71'; lid.style.color = '#aaa'; }
        else { lid.style.color = '#2ecc71'; len.style.color = '#aaa'; }
    }
}

async function testDBConnection() {
    const btn = document.querySelector('button[onclick="testDBConnection()"]');
    const resDiv = document.getElementById('test-db-result');
    const oldHtml = btn.innerHTML;
    
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Testing...`;
    btn.disabled = true;
    resDiv.innerHTML = 'Menghubungi database...';
    resDiv.className = '';
    resDiv.style.padding = '10px';
    resDiv.style.backgroundColor = 'rgba(0,0,0,0.5)';
    
    const payload = {
        db_type: document.getElementById('cfg-db_type').value,
        host: document.getElementById('cfg-host').value,
        database: document.getElementById('cfg-db').value,
        user: document.getElementById('cfg-user').value
    };
    const pass = document.getElementById('cfg-pass').value;
    if(pass) payload.password = pass;

    try {
        const res = await fetch('/api/test-db', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            resDiv.innerHTML = data.message;
            resDiv.style.backgroundColor = 'rgba(46, 204, 113, 0.2)';
            resDiv.style.border = '1px solid #2ecc71';
            resDiv.style.color = '#2ecc71';
        } else {
            resDiv.innerHTML = `<strong>Gagal:</strong> ${data.error}`;
            resDiv.style.backgroundColor = 'rgba(231, 76, 60, 0.2)';
            resDiv.style.border = '1px solid #e74c3c';
            resDiv.style.color = '#e74c3c';
        }
    } catch(err) {
        resDiv.innerHTML = `<strong>Koneksi API Error.</strong>`;
        resDiv.style.color = '#e74c3c';
    }
    
    btn.innerHTML = oldHtml;
    btn.disabled = false;
}

function updateDBHelp() {
    const sel = document.getElementById('cfg-db_type').value;
    const box = document.getElementById('db-help-box');
    
    if (sel === 'sqlite') {
        box.style.display = 'block';
        box.innerHTML = `<i class="fa-solid fa-circle-info"></i> <b>SQLite:</b> Sangat mudah. Biarkan field Host, Database, User, dan Password <b>kosong</b> atau abaikan nilainya. Sistem otomatis membuat 'wg.sqlite' di dalam folder.`;
    } else if (sel === 'odbc') {
        box.style.display = 'block';
        box.innerHTML = `<i class="fa-solid fa-circle-info"></i> <b>ODBC / DSN:</b> Masukkan koneksi string utuh Anda (Contoh: <code>DSN=my_dsn;</code>) HANYA pada field <b>Database Host</b>. Field Name, User, dan Password <b>boleh dikosongkan</b>.`;
    } else if (sel === 'oracle') {
        box.style.display = 'block';
        box.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <b>Oracle:</b> Gunakan format koneksi <code>host:port</code> (Tanpa SID). Jika menabrak error "NJS-138 (Thin mode)", itu berarti versi lawas seperti 11g butuh akses Thick mode. Akan jauh lebih mudah jika Anda membungkus Oracle via ODBC DSN Windows.`;
    } else if (sel === 'mysql' || sel === 'sqlserver') {
        box.style.display = 'block';
        box.innerHTML = `<i class="fa-solid fa-circle-info"></i> <b>${sel.toUpperCase()}:</b> Harap lengkapi semua kolom Host, Database Name, Username, dan Password (Hanya kosongkan Password jika memang tidak dipassword).`;
    } else {
        box.style.display = 'none';
    }
}

async function controlWA(action) {
    if(!confirm(`Anda yakin ingin melakukan perintah '${action}' pada Sesi WhatsApp?`)) return;
    
    try {
        const res = await fetch('/api/wa-control', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({action})
        });
        const data = await res.json();
        if(data.success) {
            alert(data.message);
            loadStatus(); // reload status screen
        } else {
            alert("Error: " + data.error);
        }
    } catch(e) {
        alert("Koneksi gagal.");
    }
}
