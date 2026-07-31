function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  const [username, password] = scheme === 'Basic' && token ? Buffer.from(token, 'base64').toString().split(':') : [];
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Owel Admin"');
    return res.status(process.env.ADMIN_USERNAME ? 401 : 503).send('Ruang Owel belum siap dibuka.');
  }
  return next();
}

function layout(title, body) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Owel</title><style>
  :root{--ink:#152028;--muted:#61717d;--line:#dfe8e4;--card:#fff;--bg:#f5f8f6;--accent:#166b52;--warn:#a66000;--danger:#a72c38}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}.shell{max-width:1180px;margin:auto;padding:32px 20px 64px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px;font-weight:800;font-size:22px}.owl{display:grid;place-items:center;width:35px;height:35px;border-radius:12px;background:var(--accent);color:white}h1{font-size:27px;margin:0 0 6px}h2{font-size:17px;margin:0}.sub{color:var(--muted);margin:0 0 25px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 24px #1730230a;margin:18px 0;overflow:hidden}.card-head{padding:17px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}table{width:100%;border-collapse:collapse}th,td{padding:13px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:#fbfdfc}tr:last-child td{border:0}.badge{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700;background:#eef4f1;color:var(--accent)}.high{background:#fff0df;color:var(--warn)}.pending{background:#fff6e9;color:var(--warn)}.suspended{background:#feecee;color:var(--danger)}button,.button{border:0;border-radius:9px;background:var(--accent);color:#fff;padding:9px 12px;font-weight:700;text-decoration:none;cursor:pointer}.ghost{background:#edf3f0;color:var(--accent)}.danger{background:var(--danger)}input{border:1px solid #cbd8d2;border-radius:9px;padding:10px;width:280px}.notice{padding:12px 15px;border-radius:10px;background:#dff5e9;color:#155a3c;margin-bottom:18px}.empty{padding:24px;color:var(--muted)}.evidence{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;padding:20px}.evidence-item{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}.media{width:100%;max-height:260px;object-fit:contain;background:#111;border-radius:8px;margin:8px 0}.meta{color:var(--muted);font-size:12px}.text{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:720px){.shell{padding:20px 12px}table{min-width:800px}.card{overflow-x:auto}}</style></head><body><main class="shell"><div class="brand"><span class="owl">O</span> Owel <span style="color:var(--muted);font-weight:500">Ruang aman</span></div>${body}</main></body></html>`;
}

function renderDashboard(cases, blocks, notice = '') {
  const rows = cases.map((item) => {
    const report = Array.isArray(item.reports) ? item.reports[0] : item.reports;
    return `<tr><td>${escapeHtml(new Date(item.created_at).toLocaleString('id-ID'))}</td><td>${escapeHtml(item.reported_id)}</td><td>${escapeHtml(report?.reason)}</td><td><span class="badge ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></td><td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td><a class="button ghost" href="/admin/cases/${escapeHtml(item.id)}">Tinjau</a></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">Belum ada laporan yang perlu dilihat.</td></tr>';
  const blockRows = blocks.map((block) => `<tr><td>${escapeHtml(block.telegram_id)}</td><td>${escapeHtml(block.note || '-')}</td><td>${escapeHtml(new Date(block.blocked_at).toLocaleString('id-ID'))}</td><td><form method="post" action="/admin/blocks/${escapeHtml(block.telegram_id)}/remove"><button class="ghost">Izinkan kembali</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada yang perlu diistirahatkan.</td></tr>';
  return layout('Ruang aman', `<h1>Ruang aman Owel</h1><p class="sub">Lihat konteksnya dulu sebelum membuat keputusan. Bukti tersimpan hingga 30 hari.</p>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}<section class="card"><div class="card-head"><h2>Laporan terbaru</h2><span class="meta">${cases.length} laporan</span></div><table><thead><tr><th>Waktu</th><th>Akun</th><th>Alasan</th><th>Prioritas</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></section><section class="card"><div class="card-head"><h2>Yang sedang diistirahatkan</h2><span class="meta">${blocks.length} akun</span></div><table><thead><tr><th>Telegram ID</th><th>Catatan</th><th>Mulai</th><th></th></tr></thead><tbody>${blockRows}</tbody></table></section>`);
}

function evidencePreview(item) {
  if (!item.telegram_file_id) return '';
  const url = `/admin/evidence/${escapeHtml(item.id)}/media`;
  if (item.kind === 'photo' || item.kind === 'animation') return `<img class="media" src="${url}" alt="Media dalam laporan">`;
  if (item.kind === 'video' || item.kind === 'video_note') return `<video class="media" controls src="${url}"></video>`;
  return `<a class="button ghost" href="${url}" target="_blank">Lihat media</a>`;
}

function createAdminRouter(app, chats, telegram) {
  app.get('/admin', basicAuth, async (req, res, next) => { try { const [cases, blocks] = await Promise.all([chats.listModerationCases(), chats.listGlobalBlocks()]); res.send(renderDashboard(cases, blocks, req.query.notice)); } catch (error) { next(error); } });
  app.get('/admin/cases/:caseId', basicAuth, async (req, res, next) => {
    try {
      const evidence = await chats.getCaseEvidence(req.params.caseId);
      const cards = evidence.map((item) => `<article class="evidence-item"><div class="meta">${escapeHtml(new Date(item.created_at).toLocaleString('id-ID'))} · Dari ${escapeHtml(item.sender_id)}</div><strong>${escapeHtml(item.kind)}</strong>${evidencePreview(item)}<div class="text">${escapeHtml(item.text_content || 'Tidak ada teks atau caption.')}</div></article>`).join('') || '<p class="empty">Belum ada bukti yang tersimpan untuk laporan ini.</p>';
      res.send(layout('Lihat laporan', `<p><a class="button ghost" href="/admin">← Kembali</a></p><h1>Lihat laporan</h1><p class="sub">Periksa konteksnya, lalu tulis catatan sebelum mengambil keputusan.</p><section class="card"><div class="evidence">${cards}</div></section><section class="card"><div class="card-head"><h2>Langkah berikutnya</h2></div><form style="padding:20px;display:flex;gap:10px;flex-wrap:wrap" method="post" action="/admin/cases/${escapeHtml(req.params.caseId)}/review"><input name="note" placeholder="Catatan peninjauan (wajib)" required maxlength="500"><button name="status" value="reviewed" class="ghost">Sudah ditinjau</button><button name="status" value="dismissed" class="ghost">Tolak laporan</button><button name="status" value="suspended" class="danger">Istirahatkan 7 hari</button></form></section>`));
    } catch (error) { next(error); }
  });
  app.get('/admin/evidence/:evidenceId/media', basicAuth, async (req, res, next) => {
    try {
      const media = await chats.getEvidenceMedia(req.params.evidenceId);
      if (!media?.telegram_file_id) return res.status(404).send('Media ini belum tersedia.');
      const link = await telegram.getFileLink(media.telegram_file_id);
      const response = await fetch(link.href);
      if (!response.ok) return res.status(404).send('Media ini sudah tidak tersedia lagi.');
      res.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
      res.set('Cache-Control', 'private, no-store');
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) { next(error); }
  });
  app.post('/admin/cases/:caseId/review', basicAuth, async (req, res, next) => { try { if (req.body.status === 'suspended') await chats.suspendFromCase(req.params.caseId, 168, req.body.note); else await chats.updateModerationCase(req.params.caseId, req.body.status, req.body.note); res.redirect('/admin?notice=Catatan+peninjauan+sudah+tersimpan.'); } catch (error) { next(error); } });
  app.post('/admin/blocks/:telegramId/remove', basicAuth, async (req, res, next) => { try { await chats.removeGlobalBlock(Number(req.params.telegramId)); res.redirect('/admin?notice=Akun+ini+sudah+bisa+mengobrol+lagi.'); } catch (error) { next(error); } });
}

module.exports = { createAdminRouter };
