const personas = {
  melchior: { label: 'MELCHIOR-1', desc: 'the scientist — weighs logic, evidence, feasibility, and risk.' },
  balthasar: { label: 'BALTHASAR-2', desc: 'the mother — weighs care, protection, and long-term wellbeing.' },
  casper: { label: 'CASPER-3', desc: 'the woman — weighs desire, intuition, and self-interest.' }
};

const FETCH_TIMEOUT_MS = 20000;
const HISTORY_KEY = 'magi_history';
const HISTORY_MAX = 25;

const questionEl = document.getElementById('input');
const runHint = document.getElementById('run-hint');
const logEl = document.getElementById('log');
const logEmpty = document.getElementById('log-empty');
const infobox = document.getElementById('infobox');
const magiLabel = document.getElementById('magi-label');
const roMode = document.getElementById('ro-mode');
const roPri = document.getElementById('ro-pri');
const tooltip = document.getElementById('tooltip');
const tName = document.getElementById('t-name');
const tStatus = document.getElementById('t-status');
const tReason = document.getElementById('t-reason');
const screenInner = document.querySelector('.screen-inner');
const historyToggle = document.getElementById('history-toggle');
const drawer = document.getElementById('drawer');
const drawerClose = document.getElementById('drawer-close');
const drawerList = document.getElementById('drawer-list');

const personaState = {
  melchior: { status: 'standby', pct: null, reasoning: null },
  balthasar: { status: 'standby', pct: null, reasoning: null },
  casper: { status: 'standby', pct: null, reasoning: null }
};
const currentVotes = { melchior: null, balthasar: null, casper: null };

let running = false;
let currentProposal = '';
let verdictEl = null;
let booted = false;

/* ---------- audio (synth beeps, no samples) ---------- */
let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
function beep(freq, dur, type, vol, delay) {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.04, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.1));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + (dur || 0.1) + 0.03);
  } catch (e) { /* audio not available — silently skip */ }
}
function beepTick() { beep(640, 0.045, 'square', 0.03); }
function beepApprove() { beep(660, 0.09, 'sine', 0.045); beep(990, 0.14, 'sine', 0.04, 0.09); }
function beepReject() { beep(220, 0.16, 'sawtooth', 0.05); beep(140, 0.2, 'sawtooth', 0.045, 0.08); }
function beepError() { beep(120, 0.22, 'square', 0.055); }
function beepFinal(approve) {
  if (approve) { beep(523, 0.12, 'sine', 0.05); beep(659, 0.12, 'sine', 0.05, 0.12); beep(784, 0.22, 'sine', 0.05, 0.24); }
  else { beep(300, 0.14, 'sawtooth', 0.05); beep(220, 0.14, 'sawtooth', 0.05, 0.12); beep(160, 0.26, 'sawtooth', 0.05, 0.24); }
}
function beepBoot() { beep(440, 0.05, 'square', 0.035); }

/* ---------- panel / status helpers ---------- */
function setPanel(key, state) {
  const g = document.getElementById('group-' + key);
  g.classList.remove('processing', 'approve', 'reject');
  if (state) g.classList.add(state);
}
function setStatus(key, text) {
  document.getElementById('status-' + key).textContent = text;
}
function setPct(key, pct) {
  const el = document.getElementById('pct-' + key);
  if (pct === null) { el.textContent = ''; return; }
  el.innerHTML = '<tspan class="a">' + pct + '%</tspan><tspan class="sep"> / </tspan><tspan class="r">' + (100 - pct) + '%</tspan>';
}
function splitLabel(pct) {
  return pct + '% approve / ' + (100 - pct) + '% reject';
}

/* ---------- tooltip ---------- */
function renderTooltip(key) {
  const p = personas[key];
  const st = personaState[key];
  tName.textContent = p.label;
  let statusText = 'standby — awaiting proposal', statusCls = '';
  if (st.status === 'analyzing…' || st.status === 'retrying…') { statusText = st.status; }
  else if (st.status === 'link error') { statusText = 'link error'; statusCls = 'reject'; }
  else if (st.pct !== null) {
    statusCls = st.pct >= 50 ? 'approve' : 'reject';
    statusText = splitLabel(st.pct) + ' — ' + (st.pct >= 50 ? 'APPROVED' : 'REJECTED');
  }
  tStatus.textContent = statusText;
  tStatus.className = 't-status' + (statusCls ? (' ' + statusCls) : '');
  tReason.textContent = st.reasoning || p.desc;
}
function showTooltip(key) { renderTooltip(key); tooltip.classList.add('show'); }
function positionTooltip(e) {
  const rect = screenInner.getBoundingClientRect();
  let x = e.clientX - rect.left + 16;
  let y = e.clientY - rect.top + 16;
  const tw = tooltip.offsetWidth || 270;
  if (x + tw > rect.width) x = e.clientX - rect.left - tw - 16;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
function hideTooltip() { tooltip.classList.remove('show'); }

/* ---------- typewriter ---------- */
function typeText(el, text, speed) {
  let i = 0;
  return new Promise((resolve) => {
    (function step() {
      el.textContent = text.slice(0, i);
      logEl.scrollTop = logEl.scrollHeight;
      i++;
      if (i <= text.length) setTimeout(step, speed || 12);
      else resolve();
    })();
  });
}

/* ---------- log ---------- */
function addLog(label, pct, reasoning, cls, retryKey) {
  if (logEmpty && logEmpty.parentNode) logEmpty.remove();
  const line = document.createElement('div');
  line.className = 'log-line' + (cls ? (' ' + cls) : '');
  const pctStr = pct !== null ? (' [' + splitLabel(pct) + ']') : '';
  const prefix = document.createElement('span');
  prefix.innerHTML = '&gt; <b>' + label + pctStr + '</b> — ';
  const reasonSpan = document.createElement('span');
  line.appendChild(prefix);
  line.appendChild(reasonSpan);
  if (retryKey) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'retry-btn';
    btn.textContent = '[RETRY]';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = '[RETRYING…]';
      retrySingle(retryKey);
    });
    line.appendChild(btn);
  }
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  typeText(reasonSpan, reasoning, 10);
}

/* ---------- networking ---------- */
async function fetchDeliberation(key, proposal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/deliberate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, proposal }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || ('HTTP ' + response.status));
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function askPersona(key, proposal, isAutoRetry) {
  const p = personas[key];
  setPanel(key, 'processing');
  setStatus(key, isAutoRetry ? 'retrying…' : 'analyzing…');
  setPct(key, null);
  personaState[key] = { status: isAutoRetry ? 'retrying…' : 'analyzing…', pct: null, reasoning: null };
  beepTick();

  try {
    const data = await fetchDeliberation(key, proposal);
    const pct = data.pct;
    const approve = pct >= 50;
    setPanel(key, approve ? 'approve' : 'reject');
    setStatus(key, approve ? 'approved' : 'rejected');
    setPct(key, pct);
    const reasoning = data.reasoning || '(no reasoning)';
    personaState[key] = { status: approve ? 'approved' : 'rejected', pct, reasoning };
    currentVotes[key] = pct;
    addLog(p.label, pct, reasoning, approve ? 'approve' : 'reject');
    approve ? beepApprove() : beepReject();
    updateConsensus();
    return pct;
  } catch (err) {
    const msg = err.message || String(err);
    if (!isAutoRetry) {
      addLog(p.label, null, 'link error — ' + msg + ' — retrying automatically…', 'reject');
      await new Promise((r) => setTimeout(r, 700));
      return askPersona(key, proposal, true);
    }
    setPanel(key, 'reject');
    setStatus(key, 'link error');
    setPct(key, null);
    personaState[key] = { status: 'link error', pct: null, reasoning: 'LINK ERROR — ' + msg };
    currentVotes[key] = null;
    addLog(p.label, null, 'LINK ERROR — ' + msg + ' — auto-retry also failed.', 'reject', key);
    beepError();
    updateConsensus();
    return null;
  }
}

function retrySingle(key) {
  if (!currentProposal) return;
  askPersona(key, currentProposal, false);
}

/* ---------- consensus / history / copy ---------- */
function updateConsensus() {
  const keys = Object.keys(personas);
  const allSettled = keys.every((k) => ['approved', 'rejected', 'link error'].includes(personaState[k].status));
  if (!allSettled) return;

  if (!verdictEl) {
    verdictEl = document.createElement('div');
    logEl.appendChild(verdictEl);
  }
  const valid = keys.map((k) => currentVotes[k]).filter((v) => v !== null);

  if (!valid.length) {
    verdictEl.className = 'verdict-line reject';
    verdictEl.innerHTML = 'CONSENSUS: <b>FAILED — ALL NODES UNREACHABLE</b>';
    magiLabel.style.fill = 'var(--red)';
    beepFinal(false);
    logEl.scrollTop = logEl.scrollHeight;
    return;
  }

  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  const approve = avg >= 50;
  verdictEl.className = 'verdict-line ' + (approve ? 'approve' : 'reject');
  verdictEl.innerHTML =
    'CONSENSUS: <b>' + splitLabel(avg) + ' — ' + (approve ? 'APPROVED' : 'REJECTED') + '</b> &nbsp;(' +
    valid.length + '/3 reporting) <button type="button" class="copy-btn" id="copy-verdict">[COPY]</button>';
  magiLabel.style.fill = approve ? '#57e0c2' : 'var(--red)';
  magiLabel.style.filter = 'drop-shadow(0 0 8px ' + (approve ? 'rgba(87,224,194,.8)' : 'rgba(255,43,31,.8)') + ')';
  beepFinal(approve);
  logEl.scrollTop = logEl.scrollHeight;
  wireCopyButton();
  saveHistory(avg, approve, valid.length);
}

function wireCopyButton() {
  const btn = document.getElementById('copy-verdict');
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const keys = Object.keys(personas);
    let text = 'MAGI CONSENSUS\nProposal: ' + currentProposal + '\n\n';
    keys.forEach((k) => {
      const st = personaState[k];
      const p = personas[k];
      text += p.label + ': ' + (st.pct !== null ? splitLabel(st.pct) : (st.status || 'unknown')) + '\n';
      if (st.reasoning) text += '  ' + st.reasoning + '\n';
    });
    const valid = keys.map((k) => currentVotes[k]).filter((v) => v !== null);
    if (valid.length) {
      const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
      text += '\nCONSENSUS: ' + splitLabel(avg) + ' — ' + (avg >= 50 ? 'APPROVED' : 'REJECTED');
    }
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '[COPIED]';
    } catch (err) {
      btn.textContent = '[COPY FAILED]';
    }
    setTimeout(() => { btn.textContent = '[COPY]'; }, 1500);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
}
function saveHistory(avg, approve, reporting) {
  try {
    const arr = loadHistory();
    arr.unshift({ ts: Date.now(), proposal: currentProposal, avg, approve, reporting });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, HISTORY_MAX)));
  } catch (e) { /* storage unavailable — skip silently */ }
  renderHistory();
}
function renderHistory() {
  const arr = loadHistory();
  drawerList.innerHTML = '';
  if (!arr.length) {
    drawerList.innerHTML = '<div class="drawer-empty">no history yet</div>';
    return;
  }
  arr.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'drawer-item';
    const d = new Date(item.ts);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const excerpt = item.proposal.length > 72 ? item.proposal.slice(0, 72) + '…' : item.proposal;
    div.innerHTML =
      '<div class="di-date">' + dateStr + '</div>' +
      '<div class="di-prop">' + escapeHtml(excerpt) + '</div>' +
      '<div class="di-verdict ' + (item.approve ? 'approve' : 'reject') + '">' +
      item.avg + '% — ' + (item.approve ? 'APPROVED' : 'REJECTED') + ' (' + item.reporting + '/3)</div>';
    div.addEventListener('click', () => {
      questionEl.value = item.proposal;
      toggleDrawer(false);
      questionEl.focus();
    });
    drawerList.appendChild(div);
  });
}
function toggleDrawer(open) {
  drawer.classList.toggle('open', open);
}

/* ---------- main run ---------- */
async function runDeliberation() {
  const proposal = questionEl.value.trim();
  if (!proposal || running) { questionEl.focus(); return; }
  running = true;
  currentProposal = proposal;
  verdictEl = null;
  questionEl.disabled = true;
  runHint.textContent = '[DELIBERATING…]';
  runHint.className = 'run-hint';
  infobox.classList.add('pulse');
  roMode.textContent = 'EX_MODE:ON';
  roPri.textContent = 'PRIORITY:AAA*';
  magiLabel.style.fill = '';
  magiLabel.style.filter = '';

  logEl.innerHTML = '';
  ['melchior', 'balthasar', 'casper'].forEach((k) => {
    setPanel(k, '');
    setStatus(k, personas[k].desc.split(' — ')[0]);
    setPct(k, null);
    personaState[k] = { status: 'standby', pct: null, reasoning: null };
    currentVotes[k] = null;
  });

  const keys = Object.keys(personas);
  await Promise.all(keys.map((k) => askPersona(k, proposal)));

  infobox.classList.remove('pulse');
  roMode.textContent = 'EX_MODE:OFF';
  roPri.textContent = 'PRIORITY:AAA';
  runHint.textContent = '[ENTER TO RUN]';
  runHint.className = 'run-hint ready';
  questionEl.disabled = false;
  running = false;
}

/* ---------- boot sequence ---------- */
function bootSequence() {
  const order = ['balthasar', 'casper', 'melchior'];
  order.forEach((key, i) => {
    setTimeout(() => {
      const g = document.getElementById('group-' + key);
      g.classList.add('online', 'boot-flash');
      beepBoot();
      setTimeout(() => g.classList.remove('boot-flash'), 420);
      if (i === order.length - 1) {
        setTimeout(() => {
          infobox.classList.add('pulse');
          beep(880, 0.08, 'square', 0.035);
          setTimeout(() => infobox.classList.remove('pulse'), 350);
          booted = true;
        }, 300);
      }
    }, 260 * i + 150);
  });
}

/* ---------- wiring ---------- */
document.querySelectorAll('.persona-group').forEach((g) => {
  const key = g.dataset.key;
  g.addEventListener('mouseenter', () => showTooltip(key));
  g.addEventListener('mousemove', positionTooltip);
  g.addEventListener('mouseleave', hideTooltip);
});

questionEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runDeliberation(); }
});
questionEl.addEventListener('input', () => {
  runHint.className = questionEl.value.trim() ? 'run-hint ready' : 'run-hint';
});

historyToggle.addEventListener('click', () => toggleDrawer(!drawer.classList.contains('open')));
drawerClose.addEventListener('click', () => toggleDrawer(false));

renderHistory();
bootSequence();