const DEMO_USER = { id: 'GAIL00123', pw: 'gail@123', name: 'Pratibha', initials: 'P' };

const FAQS = [
  { q: 'How do I validate a Bank Guarantee?', a: 'Go to the Upload tab, drag and drop one or more BG PDFs (or click to browse), then click "Run AI Review".' },
  { q: 'What file types are allowed?', a: 'Only PDF files are accepted for BG validation. Other formats are rejected at upload.' },
  { q: 'I forgot my Employee ID. What do I do?', a: 'Contact the IT Helpdesk at 1800-180-9191 or email itsupport@gail.co.in with your department and manager name.' },
  { q: 'Can I remove a completed review?', a: 'Yes. Go to the Completed tab, find the document, and click the trash icon. This removal is permanent.' },
  { q: 'Why is validation taking a long time?', a: 'Scanned/physical BGs require OCR, which takes longer than digital PDFs with embedded text. If it feels unusually slow, contact IT support.' },
];


function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  window.scrollTo(0, 0);
  if (page === 'files')   renderMyFilesTable();
  if (page === 'contact') renderFAQ();
}


function doLogin() {
  const id  = document.getElementById('emp-id').value.trim();
  const pw  = document.getElementById('emp-pw').value.trim();
  const err = document.getElementById('login-error');
  if (id === DEMO_USER.id && pw === DEMO_USER.pw) {
    err.style.display = 'none';
    goTo('upload');
    showToast('Welcome back, ' + DEMO_USER.name + '!');
  } else {
    err.style.display = 'flex';
  }
}

function doLogout() { goTo('home'); showToast('You have been signed out.'); }

function fmt(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return Math.round(b/1024) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📄';
  if (['xls','xlsx','csv'].includes(ext)) return '📊';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️';
  if (['zip','rar'].includes(ext)) return '🗜️';
  return '📁';
}


let bgQueue     = [];
let reviewQueue = [];
let reviewIdx   = 0;
let completedDocs = [];
let bgComments  = {};


document.addEventListener('DOMContentLoaded', loadCompletedFromServer);

async function loadCompletedFromServer() {
  try {
    const res = await fetch('/api/completed');
    if (!res.ok) throw new Error('Failed to fetch completed docs');
    const docs = await res.json();
    completedDocs = docs.map(d => ({
      id: d.id,
      file: { name: d.filename },
      bgData: d.bgData,
      comments: d.comments || {},
      decision: d.decision,
      reason: d.reason,
      completedAt: d.completedAt
    }));
    bgUpdateBadges();
    const completedPanel = document.getElementById('bgpanel-completed');
    if (completedPanel && completedPanel.style.display !== 'none') {
      bgRenderCompleted();
    }
    const filesPage = document.getElementById('page-files');
    if (filesPage && filesPage.classList.contains('active')) {
      renderMyFilesTable();
    }
  } catch (err) {
    console.error('Could not load completed documents from server:', err);
  }
}


function bgSwitchTab(tab) {
  ['upload','review','completed'].forEach(t => {
    document.getElementById('bgtab-' + t).classList.toggle('active', t === tab);
    document.getElementById('bgpanel-' + t).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'review')    bgRenderReview();
  if (tab === 'completed') bgRenderCompleted();
}

function bgUpdateBadges() {
  const rc = document.getElementById('bgtab-review-count');
  const cc = document.getElementById('bgtab-completed-count');
  rc.textContent = reviewQueue.length || '';
  rc.style.display = reviewQueue.length ? 'inline-block' : 'none';
  cc.textContent = completedDocs.length || '';
  cc.style.display = completedDocs.length ? 'inline-block' : 'none';
}

function bgFilesSelected(e) { bgAddToQueue([...e.target.files]); }

function bgDzOver(e)  { e.preventDefault(); document.getElementById('bg-drop-zone').classList.add('dragover'); }
function bgDzLeave()  { document.getElementById('bg-drop-zone').classList.remove('dragover'); }
function bgDzDrop(e) {
  e.preventDefault(); bgDzLeave();
  const files = [...e.dataTransfer.files].filter(f =>
    f.name.toLowerCase().endsWith('.pdf'));
  if (!files.length) { showToast('Only PDF files are accepted.'); return; }
  bgAddToQueue(files);
}

function bgAddToQueue(files) {
  const existing = new Set(bgQueue.map(q => q.file.name + q.file.size));
  files.forEach(f => {
    if (!existing.has(f.name + f.size)) {
      bgQueue.push({ file: f, objectUrl: URL.createObjectURL(f), status: 'pending', bgData: null });
    }
  });
  bgRenderQueue();
  document.getElementById('bg-validate-section').style.display = bgQueue.length ? 'block' : 'none';
}

function bgRemoveFromQueue(i) {
  URL.revokeObjectURL(bgQueue[i].objectUrl);
  bgQueue.splice(i, 1);
  bgRenderQueue();
  document.getElementById('bg-validate-section').style.display = bgQueue.length ? 'block' : 'none';
}

function bgClearQueue() {
  bgQueue.forEach(q => URL.revokeObjectURL(q.objectUrl));
  bgQueue = [];
  document.getElementById('bg-file-input').value = '';
  document.getElementById('bg-validate-section').style.display = 'none';
  document.getElementById('bg-result').innerHTML = '';
  bgRenderQueue();
}

function bgRenderQueue() {
  const wrap = document.getElementById('bg-queue-wrap');
  if (!bgQueue.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = bgQueue.map((q, i) => {
    const icon = q.status === 'pending'    ? '<span style="color:var(--muted)">⏳</span>'
               : q.status === 'validating' ? '<span style="color:#FBBF24">⟳</span>'
               : q.status === 'done'       ? '<span style="color:#34D399">✔</span>'
               :                            '<span style="color:var(--red)">✖</span>';
    return `<div class="file-row" style="border:0.5px solid var(--border);border-radius:7px;margin-bottom:6px">
      <span style="font-size:18px">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${q.file.name}</div>
        <div style="font-size:11px;color:var(--muted)">${fmt(q.file.size)} · ${q.status}</div>
      </div>
      <button style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px" onclick="bgRemoveFromQueue(${i})"><i class="ti ti-x"></i></button>
    </div>`;
  }).join('');
}


async function bgValidateAll() {
  if (!bgQueue.length) { showToast('Add at least one PDF first.'); return; }
  const btn = document.getElementById('bg-validate-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Validating...';


  const CONCURRENCY = 3;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < bgQueue.length) {
      const i = nextIndex++;
      bgQueue[i].status = 'validating';
      bgRenderQueue();
      const fd = new FormData();
      fd.append('file', bgQueue[i].file);
      try {
        const res  = await fetch('/validate-bg', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Server error');
        bgQueue[i].status = 'done';
        bgQueue[i].bgData = data;
      } catch (err) {
        bgQueue[i].status = 'error';
      }
      bgRenderQueue();
    }
  }

  const workerCount = Math.min(CONCURRENCY, bgQueue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));


  bgQueue.forEach(q => {
    reviewQueue.push({ ...q, comments: {} });
  });
  bgQueue = [];
  document.getElementById('bg-file-input').value = '';
  document.getElementById('bg-validate-section').style.display = 'none';
  document.getElementById('bg-result').innerHTML = '';
  bgRenderQueue();
  bgUpdateBadges();

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-shield-check"></i> Validate & Send to Review';
  reviewIdx = 0;
  bgSwitchTab('review');
  showToast('Validation done — files moved to Review tab.');
}


function bgRenderReview() {
  const panel = document.getElementById('bgpanel-review');
  if (!reviewQueue.length) {
    panel.innerHTML = `<div style="text-align:center;padding:3rem 2rem;color:var(--muted)">
      <i class="ti ti-inbox" style="font-size:44px;display:block;margin-bottom:10px"></i>
      <p style="font-size:14px;font-weight:500">No documents in Review</p>
      <p style="font-size:12px;margin-top:4px">Upload and validate BG files in the Upload tab first.</p>
    </div>`;
    return;
  }
  if (reviewIdx >= reviewQueue.length) reviewIdx = 0;
  const item = reviewQueue[reviewIdx];
  const bgData = item.bgData;
  bgPdfZoom = 1;

  const strip = reviewQueue.map((it, idx) => `
    <div onclick="bgGoto(${idx})" style="
      cursor:pointer;padding:5px 10px;border-radius:6px;font-size:11px;
      border:1.5px solid ${idx===reviewIdx ? 'var(--green-mid)' : 'var(--border)'};
      background:${idx===reviewIdx ? 'var(--green-light)' : 'var(--white)'};
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;
      display:flex;align-items:center;gap:4px">
      ${it.bgData ? (it.bgData.verdict === 'COMPLIANT' ? '✔' : it.bgData.verdict === 'DISCREPANT' ? '✖' : '⚠') : '📄'}
      <span style="overflow:hidden;text-overflow:ellipsis">${it.file.name}</span>
    </div>`).join('');

  const palette = { pass:['#1E6E48','#E4F0E8'], warn:['#9A6B14','#F5ECD8'], fail:['#A92E26','#F6E2DF'] };
  let rightContent = '';

  if (bgData) {
    const vcolors = { COMPLIANT:'#1E6E48', 'NEEDS REVIEW':'#9A6B14', DISCREPANT:'#A92E26' };
    const vcol = vcolors[bgData.verdict] || '#333';

    const fieldMap = [
      ['BG number', bgData.fields.bg_number],
      ['Bank', bgData.fields.issuing_bank],
      ['Amount', bgData.fields.amount_figures ? 'Rs. ' + bgData.fields.amount_figures.toLocaleString('en-IN') : null],
      ['Expiry', bgData.fields.expiry],
      ['Claim expiry', bgData.fields.claim_expiry],
      ['PO / LOA', bgData.fields.po_reference],
    ].filter(([,v]) => v);

    const fieldRows = fieldMap.map(([k,v]) =>
      `<tr><td style="color:var(--muted);padding:3px 12px 3px 0;font-size:11px">${k}</td>
       <td style="font-family:monospace;font-size:11px">${v}</td></tr>`
    ).join('');

    const visibleChecks = bgData.checks.filter(c => c.status !== 'info');
    const checkRows = visibleChecks.map(c => {
      const [fg,bg2] = palette[c.status] || ['#333','#eee'];
      const lbl = c.status === 'warn' ? 'REVIEW' : c.status.toUpperCase();
      return `<div style="padding:5px 0;border-bottom:1px solid var(--border-soft);font-size:12px">
        <span style="font-family:monospace;font-size:10px;font-weight:700;padding:1px 6px;background:${bg2};color:${fg}">${lbl}</span>
        <b style="margin-left:6px">${c.label}</b>
      </div>`;
    }).join('');

    const clauseRows = (bgData.clauses || []).map(cl => {
      const [fg,bg2] = palette[cl.status] || ['#333','#eee'];
      const lbl = cl.status === 'warn' ? 'REVIEW' : cl.status.toUpperCase();
      const needsComment = cl.status === 'warn' || cl.status === 'fail';
      const saved = item.comments[cl.id] || '';
      return `<div style="padding:9px 0;border-bottom:1px solid var(--border-soft)">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
          <span style="font-family:monospace;font-size:10px;font-weight:700;padding:2px 7px;background:${bg2};color:${fg};letter-spacing:1px">${lbl}</span>
          <b style="font-size:13px">${cl.id} — ${cl.title}</b>
          <span style="font-family:monospace;font-size:11px;color:var(--muted)">${cl.score}% match</span>
        </div>
        ${cl.note ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">${cl.note}</div>` : ''}
        <div style="font-size:12px;line-height:1.6;margin-top:5px;padding:7px 10px;background:rgba(255,255,255,0.03);border:0.5px solid var(--border-soft);border-radius:6px">${cl.diff}</div>
        ${needsComment ? `<div style="margin-top:7px">
          <label style="font-size:11px;font-weight:600;color:var(--text);display:block;margin-bottom:3px">
            <i class="ti ti-message"></i> Reviewer comment — ${cl.id}
          </label>
          <textarea id="rv-comment-${cl.id}" rows="2"
            style="width:100%;padding:6px 10px;border:0.5px solid var(--border);border-radius:6px;font-size:12px;resize:vertical;outline:none;font-family:inherit;background:rgba(255,255,255,0.03);color:var(--text)"
            placeholder="Add your remark or decision for this clause..."
            onchange="bgSaveComment('${cl.id}', this.value)"
          >${saved}</textarea>
        </div>` : ''}
      </div>`;
    }).join('');

    rightContent = `
      <div style="padding:0 0 8px 0;border-bottom:1px solid var(--border);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:13px;font-weight:600">${item.file.name}</div>
          <div style="font-size:10px;font-family:monospace;color:var(--muted);margin-top:2px">${bgData.kind.toUpperCase()} · ${bgData.page_count} PAGES</div>
        </div>
        <div style="border:2px double ${vcol};color:${vcol};padding:4px 10px;transform:rotate(-3deg);font-family:monospace;font-weight:700;letter-spacing:2px;font-size:11px">${bgData.verdict}</div>
      </div>

      <div style="font-size:10px;letter-spacing:2px;color:var(--muted);font-weight:700;margin-bottom:5px">EXTRACTED FIELDS</div>
      <table style="border-collapse:collapse;margin-bottom:12px;width:100%">${fieldRows}</table>

      <div style="font-size:10px;letter-spacing:2px;color:var(--muted);font-weight:700;margin-bottom:4px">
        CHECKS — ${bgData.counts.fail} FAIL · ${bgData.counts.warn} REVIEW · ${bgData.counts.pass} PASS
      </div>
      <div style="margin-bottom:12px">${checkRows}</div>

      <div style="font-size:10px;letter-spacing:2px;color:var(--muted);font-weight:700;margin-bottom:4px">CLAUSE-BY-CLAUSE vs F-4</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Add a comment on REVIEW/FAIL clauses before marking complete.</div>
      ${clauseRows}`;
  } else {
    rightContent = `<div style="background:var(--green-light);border-radius:8px;padding:12px 14px;font-size:13px;color:var(--green-mid)">
      <i class="ti ti-info-circle"></i> No BG validation data — validation may have failed. You can still mark this as completed.
    </div>`;
  }

  panel.innerHTML = `
    <div style="padding:14px 18px">
      <!-- Arrow nav + file name + per-file CSV export -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="bgNav(-1)" ${reviewIdx===0?'disabled':''}><i class="ti ti-chevron-left"></i></button>
        <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.file.name}</span>
        <span style="font-size:12px;color:var(--muted);white-space:nowrap">${reviewIdx+1} / ${reviewQueue.length}</span>
        <button class="btn btn-secondary btn-sm" onclick="bgExportSingleCSV(${reviewIdx})"><i class="ti ti-download"></i> CSV</button>
        <button class="btn btn-secondary btn-sm" onclick="bgNav(1)" ${reviewIdx===reviewQueue.length-1?'disabled':''}><i class="ti ti-chevron-right"></i></button>
      </div>

      <!-- Thumbnail strip -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${strip}</div>

      <!-- Split: PDF left, review right -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
        <!-- PDF -->
        <div style="border:1.5px solid #123B47;border-radius:8px;overflow:hidden;background:#0B2530;position:sticky;top:10px">
          <div style="padding:7px 12px;font-size:10px;letter-spacing:2px;color:#9FDCE8;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span>ORIGINAL DOCUMENT</span>
            <span style="display:flex;gap:10px;letter-spacing:0;font-weight:500;align-items:center">
              <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:#DC2626;display:inline-block"></span>Fail</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:#F59E0B;display:inline-block"></span>Review</span>
              <span style="display:flex;align-items:center;gap:2px;margin-left:6px;border-left:1px solid rgba(255,255,255,0.15);padding-left:10px">
                <button onclick="bgZoomPdf(-0.15)" style="background:rgba(255,255,255,0.1);border:none;color:#9FDCE8;width:20px;height:20px;border-radius:4px;cursor:pointer;font-size:13px;line-height:1">−</button>
                <span id="bg-pdf-zoom-label" style="width:38px;text-align:center;font-size:10px">100%</span>
                <button onclick="bgZoomPdf(0.15)" style="background:rgba(255,255,255,0.1);border:none;color:#9FDCE8;width:20px;height:20px;border-radius:4px;cursor:pointer;font-size:13px;line-height:1">+</button>
              </span>
            </span>
          </div>
          <div id="bg-pdf-container" style="max-height:600px;overflow-y:auto;background:#525659"></div>
        </div>

        <!-- Review panel -->
        <div style="border:0.5px solid var(--border);border-radius:8px;padding:14px;background:var(--white);max-height:640px;overflow-y:auto">
          ${rightContent}

          <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:var(--text);margin-bottom:8px">DECISION</div>
            <div style="display:flex;gap:8px;margin-bottom:10px">
              <button type="button" onclick="bgSetDecision('valid')"
                style="flex:1;padding:9px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;
                  border:1.5px solid ${item.decision === 'valid' ? '#1E6E48' : 'var(--border)'};
                  background:${item.decision === 'valid' ? '#E4F0E8' : 'var(--white)'};
                  color:${item.decision === 'valid' ? '#1E6E48' : 'var(--muted)'}">
                <i class="ti ti-check"></i> Valid
              </button>
              <button type="button" onclick="bgSetDecision('invalid')"
                style="flex:1;padding:9px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;
                  border:1.5px solid ${item.decision === 'invalid' ? '#A92E26' : 'var(--border)'};
                  background:${item.decision === 'invalid' ? '#F6E2DF' : 'var(--white)'};
                  color:${item.decision === 'invalid' ? '#A92E26' : 'var(--muted)'}">
                <i class="ti ti-x"></i> Invalid
              </button>
            </div>
            <label class="form-label">Reason <span style="color:var(--muted);font-weight:400">(required)</span></label>
            <textarea id="bg-decision-reason" rows="2" class="form-input"
              placeholder="State the reason for this decision..."
              onchange="bgSaveReason(this.value)">${item.reason || ''}</textarea>
          </div>

          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="bgMarkCompleted()"><i class="ti ti-check"></i> Submit to Completed</button>
            <button class="btn btn-secondary" onclick="bgReject()"><i class="ti ti-x"></i> Discard</button>
          </div>
        </div>
      </div>
    </div>`;

  const pdfContainer = document.getElementById('bg-pdf-container');
  if (pdfContainer) bgRenderPdfWithHighlights(item, pdfContainer);
}

function bgNav(dir) {
  reviewIdx = Math.max(0, Math.min(reviewQueue.length - 1, reviewIdx + dir));
  bgRenderReview();
}

function bgGoto(idx) { reviewIdx = idx; bgRenderReview(); }


if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
} else {
  console.warn('pdfjsLib did not load — PDF highlight rendering will fall back to a plain iframe (no highlight boxes will be visible). Check that the <script src=".../pdf.js/2.16.105/pdf.min.js"> tag in index.html <head> is loading (open Network tab and look for pdf.min.js).');
}

let bgPdfZoom = 1;

function bgZoomPdf(delta) {
  bgPdfZoom = Math.min(3, Math.max(0.4, +(bgPdfZoom + delta).toFixed(2)));
  const label = document.getElementById('bg-pdf-zoom-label');
  if (label) label.textContent = Math.round(bgPdfZoom * 100) + '%';
  const item = reviewQueue[reviewIdx];
  const container = document.getElementById('bg-pdf-container');
  if (item && container) bgRenderPdfWithHighlights(item, container);
}

async function bgRenderPdfWithHighlights(item, containerEl) {
  containerEl.innerHTML = '<div style="padding:20px;color:#9FDCE8;font-size:12px">Loading PDF…</div>';

  if (!window.pdfjsLib) {
    console.warn('bgRenderPdfWithHighlights: window.pdfjsLib is undefined, using plain iframe fallback (no highlights will show).');
    containerEl.innerHTML = `<iframe src="${item.objectUrl}" style="width:100%;height:600px;border:none;background:#fff"></iframe>`;
    return;
  }

  try {
    const pdf = await pdfjsLib.getDocument(item.objectUrl).promise;
    containerEl.innerHTML = '';

    const byPage = {};
    (item.bgData?.clauses || []).forEach(cl => {
      if (cl.highlight && typeof cl.highlight.page === 'number') {
        (byPage[cl.highlight.page] = byPage[cl.highlight.page] || []).push(cl);
      }
    });

    const containerWidth   = containerEl.clientWidth || 500;
    const devicePixelRatio = window.devicePixelRatio || 1;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1 });
      const fitScale = (containerWidth / unscaledViewport.width) * bgPdfZoom;
      const viewport = page.getViewport({ scale: fitScale });

      const pageWrap = document.createElement('div');
      pageWrap.style.cssText = `position:relative;margin-bottom:8px;line-height:0;width:${viewport.width}px;height:${viewport.height}px;`;

      const canvas = document.createElement('canvas');
      canvas.width  = Math.floor(viewport.width * devicePixelRatio);
      canvas.height = Math.floor(viewport.height * devicePixelRatio);
      canvas.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px;`;
      pageWrap.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const renderTransform = devicePixelRatio !== 1
        ? [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0]
        : null;
      await page.render({ canvasContext: ctx, viewport, transform: renderTransform }).promise;

      const clausesHere = byPage[pageNum - 1] || [];
      clausesHere.forEach(cl => {
        const isFail = cl.status === 'fail';
        const fill   = isFail ? 'rgba(220,38,38,0.30)' : 'rgba(245,158,11,0.30)';
        const border = isFail ? '#DC2626' : '#F59E0B';
        (cl.highlight.rects || []).forEach(([x0, y0, x1, y1]) => {
          const box = document.createElement('div');
          box.title = cl.id + ' — ' + cl.title;
          box.style.cssText = `position:absolute;left:${x0*fitScale}px;top:${y0*fitScale}px;
            width:${(x1-x0)*fitScale}px;height:${(y1-y0)*fitScale}px;
            background:${fill};border:1.5px solid ${border};border-radius:2px;
            pointer-events:none;`;
          pageWrap.appendChild(box);
        });
      });

      containerEl.appendChild(pageWrap);
    }
  } catch (err) {
    console.error('PDF.js render failed, falling back to plain viewer:', err);
    containerEl.innerHTML = `<iframe src="${item.objectUrl}" style="width:100%;height:600px;border:none;background:#fff"></iframe>`;
  }
}

function bgSaveComment(clauseId, text) {
  if (!reviewQueue[reviewIdx]) return;
  reviewQueue[reviewIdx].comments[clauseId] = text;
}

function bgSetDecision(decision) {
  if (!reviewQueue[reviewIdx]) return;
  reviewQueue[reviewIdx].decision = decision;
  bgRenderReview();
}

function bgSaveReason(text) {
  if (!reviewQueue[reviewIdx]) return;
  reviewQueue[reviewIdx].reason = text;
}


async function bgMarkCompleted() {
  if (!reviewQueue[reviewIdx]) return;
  const item = reviewQueue[reviewIdx];

  (item.bgData?.clauses || []).forEach(cl => {
    if (cl.status === 'warn' || cl.status === 'fail') {
      const el = document.getElementById('rv-comment-' + cl.id);
      if (el) item.comments[cl.id] = el.value;
    }
  });
  const reasonEl = document.getElementById('bg-decision-reason');
  if (reasonEl) item.reason = reasonEl.value;

  if (!item.decision) {
    showToast('Select Valid or Invalid before submitting.');
    return;
  }
  if (!item.reason || !item.reason.trim()) {
    showToast('A reason is required before submitting.');
    return;
  }

  const completedAt = new Date().toLocaleString('en-IN');
  const payload = {
    filename: item.file.name,
    bgData: item.bgData,
    comments: item.comments,
    decision: item.decision,
    reason: item.reason,
    completedAt
  };

  let savedId = null;
  try {
    const res = await fetch('/api/completed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Server rejected the save');
    const saved = await res.json();
    savedId = saved.id;
  } catch (err) {
    console.error('Failed to save completed doc to server:', err);
    showToast('Warning: could not save to database — this will be lost on reload.');
  }

  completedDocs.unshift({
    id: savedId,
    file: { name: item.file.name },
    bgData: item.bgData,
    comments: item.comments,
    decision: item.decision,
    reason: item.reason,
    completedAt
  });

  reviewQueue.splice(reviewIdx, 1);
  if (reviewIdx >= reviewQueue.length && reviewIdx > 0) reviewIdx--;
  bgUpdateBadges();
  bgRenderReview();
  showToast('Moved to Completed.');
}

function bgReject() {
  if (!reviewQueue[reviewIdx]) return;
  const name = reviewQueue[reviewIdx].file.name;
  URL.revokeObjectURL(reviewQueue[reviewIdx].objectUrl);
  reviewQueue.splice(reviewIdx, 1);
  if (reviewIdx >= reviewQueue.length && reviewIdx > 0) reviewIdx--;
  bgUpdateBadges();
  bgRenderReview();
  showToast(name + ' discarded.');
}

// ── Export a SINGLE file's review report as CSV (available while still in AI Review) ──
function bgExportSingleCSV(idx) {
  const item = reviewQueue[idx];
  if (!item) { showToast('File not found.'); return; }
  const bgData = item.bgData;
  if (!bgData) { showToast('No validation data for this file yet.'); return; }

  const escapeCsv = (val) => {
    const s = (val === undefined || val === null) ? '' : String(val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const rows = [];
  rows.push(['Section', 'Item', 'Status / Value', 'Score', 'Comment'].map(escapeCsv).join(','));
  rows.push(['File', item.file.name, '', '', ''].map(escapeCsv).join(','));
  rows.push(['Verdict', bgData.verdict, '', '', ''].map(escapeCsv).join(','));

  const fieldMap = [
    ['BG number', bgData.fields.bg_number],
    ['Bank', bgData.fields.issuing_bank],
    ['Amount', bgData.fields.amount_figures],
    ['Expiry', bgData.fields.expiry],
    ['Claim expiry', bgData.fields.claim_expiry],
    ['PO / LOA', bgData.fields.po_reference],
  ];
  fieldMap.forEach(([k, v]) => {
    if (v) rows.push(['Field', k, v, '', ''].map(escapeCsv).join(','));
  });

  (bgData.checks || []).filter(c => c.status !== 'info').forEach(c => {
    rows.push(['Check', c.label, c.status.toUpperCase(), '', ''].map(escapeCsv).join(','));
  });

  (bgData.clauses || []).forEach(cl => {
    const comment = (item.comments && item.comments[cl.id]) || '';
    rows.push(['Clause', cl.id + ' - ' + cl.title, cl.status.toUpperCase(), cl.score, comment].map(escapeCsv).join(','));
  });

  if (item.decision) {
    rows.push(['Decision', item.decision, '', '', item.reason || ''].map(escapeCsv).join(','));
  }

  const csv  = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (item.file.name.replace(/\.pdf$/i, '') || 'bg-review') + '-review.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV exported for ' + item.file.name);
}

function bgRenderCompleted() {
  const panel = document.getElementById('bgpanel-completed');
  if (!completedDocs.length) {
    panel.innerHTML = `<div style="text-align:center;padding:3rem 2rem;color:var(--muted)">
      <i class="ti ti-circle-check" style="font-size:44px;display:block;margin-bottom:10px;color:var(--green-mid)"></i>
      <p style="font-size:14px;font-weight:500">No completed documents yet</p>
      <p style="font-size:12px;margin-top:4px">Documents appear here once marked Complete in the Review tab.</p>
    </div>`;
    return;
  }
  const palette = { pass:['#1E6E48','#E4F0E8'], warn:['#9A6B14','#F5ECD8'], fail:['#A92E26','#F6E2DF'] };

  const cards = completedDocs.map((item, idx) => {
    const bgData = item.bgData;
    const vcolors = { COMPLIANT:'#1E6E48', 'NEEDS REVIEW':'#9A6B14', DISCREPANT:'#A92E26' };
    const verd = bgData ? bgData.verdict : '—';
    const vcol = vcolors[verd] || '#666';

    const flagged = bgData ? (bgData.clauses || []).filter(cl => cl.status !== 'pass') : [];
    const flaggedHtml = flagged.map(cl => {
      const [fg,bg2] = palette[cl.status] || ['#333','#eee'];
      const lbl = cl.status === 'warn' ? 'REVIEW' : cl.status.toUpperCase();
      const comment = item.comments[cl.id];
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border-soft)">
        <span style="font-family:monospace;font-size:10px;font-weight:700;padding:1px 6px;background:${bg2};color:${fg}">${lbl}</span>
        <b style="font-size:12px;margin-left:6px">${cl.id}</b> — ${cl.title}
        <span style="font-size:11px;color:var(--muted);margin-left:6px">${cl.score}%</span>
        ${comment ? `<div style="margin-top:5px;padding:5px 9px;background:rgba(245,158,11,0.12);border:0.5px solid rgba(245,158,11,0.35);border-radius:5px;font-size:11px">
          <i class="ti ti-message" style="color:#FBBF24"></i> <b>${cl.id}:</b> ${comment}
        </div>` : ''}
      </div>`;
    }).join('');

    const decisionBadge = item.decision === 'valid'
      ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;background:#E4F0E8;color:#1E6E48"><i class="ti ti-check"></i> VALID</span>`
      : item.decision === 'invalid'
      ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;background:#F6E2DF;color:#A92E26"><i class="ti ti-x"></i> INVALID</span>`
      : '';

    return `<div style="background:var(--white);border:0.5px solid var(--border);border-radius:8px;padding:14px;margin:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text)">📄 ${item.file.name}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Completed: ${item.completedAt}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${decisionBadge}
          <div style="border:2px double ${vcol};color:${vcol};padding:4px 10px;font-family:monospace;font-weight:700;letter-spacing:2px;font-size:11px;transform:rotate(-3deg)">${verd}</div>
          <button class="btn btn-danger btn-sm" onclick="bgRemoveCompleted(${idx})"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      ${item.reason ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(255,255,255,0.04);border:0.5px solid var(--border-soft);border-radius:6px;font-size:12px">
        <b style="color:var(--text)">Reason:</b> ${item.reason}
      </div>` : ''}
      ${flaggedHtml ? `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text);margin-bottom:6px">FLAGGED CLAUSES &amp; COMMENTS</div>
        ${flaggedHtml}
      </div>` : ''}
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:flex-end;padding:14px 18px 0">
      <button class="btn btn-secondary btn-sm" onclick="bgExportCompletedCSV()"><i class="ti ti-download"></i> Export CSV</button>
    </div>
    <div style="padding-bottom:1rem">${cards}</div>`;
}

function bgExportCompletedCSV() {
  if (!completedDocs.length) { showToast('No completed reviews to export yet.'); return; }

  const escapeCsv = (val) => {
    const s = (val === undefined || val === null) ? '' : String(val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const headers = ['File name', 'Verdict', 'Decision', 'Reason', 'Flagged clauses', 'Completed at'];
  const rows = completedDocs.map(item => {
    const flaggedCount = item.bgData?.clauses?.filter(cl => cl.status !== 'pass').length ?? 0;
    return [
      item.file.name,
      item.bgData?.verdict || '',
      item.decision || '',
      item.reason || '',
      flaggedCount,
      item.completedAt || '',
    ].map(escapeCsv).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bg-validator-completed-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV exported.');
}

function renderMyFilesTable() {
  const tbody = document.getElementById('files-tbody');
  if (!tbody) return;

  const searchEl  = document.getElementById('myfiles-search');
  const verdictEl = document.getElementById('myfiles-verdict-filter');
  const search    = (searchEl?.value || '').trim().toLowerCase();
  const verdictFilter = verdictEl?.value || '';

  let rows = completedDocs.filter(item => {
    const matchesSearch  = !search || item.file.name.toLowerCase().includes(search);
    const matchesVerdict = !verdictFilter || (item.bgData?.verdict === verdictFilter);
    return matchesSearch && matchesVerdict;
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:var(--muted)">
      ${completedDocs.length ? 'No files match your search/filter.' : 'No completed reviews yet — validate a BG in the Upload tab to get started.'}
    </td></tr>`;
    return;
  }

  const vcolors = { COMPLIANT: 'badge-green', 'NEEDS REVIEW': 'badge-blue', DISCREPANT: 'badge-red' };

  tbody.innerHTML = rows.map(item => {
    const verd = item.bgData?.verdict || '—';
    const verdictBadgeClass = vcolors[verd] || 'badge-gray';
    const decisionHtml = item.decision === 'valid'
      ? '<span class="badge badge-green">Valid</span>'
      : item.decision === 'invalid'
      ? '<span class="badge badge-red">Invalid</span>'
      : '<span class="badge badge-gray">—</span>';
    const idx = completedDocs.indexOf(item);

    return `<tr>
      <td><div class="file-name-cell">📄 ${item.file.name}</div></td>
      <td><span class="badge ${verdictBadgeClass}">${verd}</span></td>
      <td>${decisionHtml}</td>
      <td style="color:var(--muted);font-size:12.5px">${item.completedAt || '—'}</td>
      <td>
        <div class="td-actions">
          <button class="btn btn-secondary btn-sm" onclick="bgOpenInCompletedTab()"><i class="ti ti-eye"></i> View</button>
          <button class="btn btn-danger btn-sm" onclick="bgRemoveCompleted(${idx}); renderMyFilesTable();"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function bgOpenInCompletedTab() {
  goTo('upload');
  bgSwitchTab('completed');
}

async function bgRemoveCompleted(idx) {
  const item = completedDocs[idx];
  completedDocs.splice(idx, 1);
  bgUpdateBadges();
  bgRenderCompleted();

  if (item && item.id != null) {
    try {
      await fetch('/api/completed/' + item.id, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete completed doc from server:', err);
    }
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

function renderFAQ() {
  document.getElementById('faq-list').innerHTML = FAQS.map((f, i) => `
    <div class="faq-item" id="faq${i}">
      <div class="faq-q" onclick="toggleFAQ(${i})">${f.q}<i class="ti ti-chevron-down faq-icon"></i></div>
      <div class="faq-a">${f.a}</div>
    </div>`).join('');
}

function toggleFAQ(i) { document.getElementById('faq' + i).classList.toggle('open'); }
