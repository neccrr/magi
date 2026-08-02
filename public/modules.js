const DEFAULT_MODEL = 'agnes-2.0-flash';

  const personas = {
    melchior: {
      label: 'MELCHIOR-1',
      desc: 'the scientist — weighs logic, evidence, feasibility, and risk.',
      system: `You are MELCHIOR-1, the "Scientist" personality within the MAGI triune decision system. You evaluate proposals purely through logic, evidence, feasibility, and risk analysis. You are dispassionate and analytical, weighing costs, probabilities, and second-order consequences. You are skeptical of appeals to emotion or tradition. Respond ONLY with strict JSON, no markdown fences, no preamble: {"approve_pct": <integer 0-100, your confidence the proposal should be approved>, "reasoning": "2-3 sentences in character, terse and analytical"}`
    },
    balthasar: {
      label: 'BALTHASAR-2',
      desc: 'the mother — weighs care, protection, and long-term wellbeing.',
      system: `You are BALTHASAR-2, the "Mother" personality within the MAGI triune decision system. You evaluate proposals through protectiveness, care, and long-term wellbeing of everyone affected, especially the vulnerable. You weigh nurture, safety, and consequences for relationships and people over pure logic. Respond ONLY with strict JSON, no markdown fences, no preamble: {"approve_pct": <integer 0-100, your confidence the proposal should be approved>, "reasoning": "2-3 sentences in character, warm but firm"}`
    },
    casper: {
      label: 'CASPER-3',
      desc: 'the woman — weighs desire, intuition, and self-interest.',
      system: `You are CASPER-3, the "Woman" personality within the MAGI triune decision system. You evaluate proposals through personal desire, intuition, self-interest, and human ambition. You ask what is actually wanted, what feels right, and what serves the individual, not just the collective. You are the most willing to take a bold or unconventional position. Respond ONLY with strict JSON, no markdown fences, no preamble: {"approve_pct": <integer 0-100, your confidence the proposal should be approved>, "reasoning": "2-3 sentences in character, direct and personal"}`
    }
  };

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

  const personaState = {
    melchior: { status: 'standby', pct: null, reasoning: null },
    balthasar: { status: 'standby', pct: null, reasoning: null },
    casper: { status: 'standby', pct: null, reasoning: null }
  };

  let running = false;

  function extractJSON(text) {
    let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { JSON.parse(cleaned); return cleaned; } catch (_) {
      const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
      if (a !== -1 && b !== -1 && b > a) {
        const candidate = cleaned.substring(a, b + 1);
        JSON.parse(candidate);
        return candidate;
      }
      throw new Error('No JSON object found: ' + text.substring(0, 200));
    }
  }

  function setPanel(key, state) {
    document.getElementById('group-' + key).setAttribute('class', 'persona-group' + (state ? ' ' + state : ''));
  }

  function renderTooltip(key) {
    const p = personas[key];
    const st = personaState[key];
    tName.textContent = p.label;
    let statusText = 'standby — awaiting proposal', statusCls = '';
    if (st.status === 'analyzing…') { statusText = 'analyzing…'; }
    else if (st.status === 'link error') { statusText = 'link error'; statusCls = 'reject'; }
    else if (st.pct !== null) {
      statusCls = st.pct >= 50 ? 'approve' : 'reject';
      statusText = splitLabel(st.pct) + ' — ' + (st.pct >= 50 ? 'APPROVED' : 'REJECTED');
    }
    tStatus.textContent = statusText;
    tStatus.className = 't-status' + (statusCls ? (' ' + statusCls) : '');
    tReason.textContent = st.reasoning || p.desc;
  }

  function showTooltip(key) {
    renderTooltip(key);
    tooltip.classList.add('show');
  }

  function positionTooltip(e) {
    const rect = screenInner.getBoundingClientRect();
    let x = e.clientX - rect.left + 16;
    let y = e.clientY - rect.top + 16;
    const tw = tooltip.offsetWidth || 270;
    if (x + tw > rect.width) x = e.clientX - rect.left - tw - 16;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    tooltip.classList.remove('show');
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

  function addLog(label, pct, reasoning, cls) {
    if (logEmpty) logEmpty.remove();
    const line = document.createElement('div');
    line.className = 'log-line' + (cls ? (' ' + cls) : '');
    const pctStr = pct !== null ? (' [' + splitLabel(pct) + ']') : '';
    line.innerHTML = '&gt; <b>' + label + pctStr + '</b> — ' + reasoning;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function askPersona(key, proposal) {
    const p = personas[key];
    setPanel(key, 'processing');
    setStatus(key, 'analyzing…');
    setPct(key, null);
    personaState[key] = { status: 'analyzing…', pct: null, reasoning: null };

    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: p.system },
            { role: 'user', content: 'Proposal for deliberation:\n\n' + proposal }
          ]
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error || ('HTTP ' + response.status));

      const raw = data.choices?.[0]?.message?.content || '';
      if (!raw) throw new Error('empty response');
      const parsed = JSON.parse(extractJSON(raw));

      let pct = Math.round(Number(parsed.approve_pct));
      if (isNaN(pct)) pct = 50;
      pct = Math.max(0, Math.min(100, pct));

      const approve = pct >= 50;
      setPanel(key, approve ? 'approve' : 'reject');
      setStatus(key, approve ? 'approved' : 'rejected');
      setPct(key, pct);
      const reasoning = parsed.reasoning || '(no reasoning)';
      personaState[key] = { status: approve ? 'approved' : 'rejected', pct, reasoning };
      addLog(p.label, pct, reasoning, approve ? 'approve' : 'reject');
      return pct;
    } catch (err) {
      setPanel(key, 'reject');
      setStatus(key, 'link error');
      setPct(key, null);
      const msg = err.message || String(err);
      personaState[key] = { status: 'link error', pct: null, reasoning: 'LINK ERROR — ' + msg };
      addLog(p.label, null, 'LINK ERROR — ' + msg, 'reject');
      return null;
    }
  }

  function finalize(votes) {
    const valid = votes.filter(v => v !== null);
    const verdictDiv = document.createElement('div');
    if (!valid.length) {
      verdictDiv.className = 'verdict-line reject';
      verdictDiv.innerHTML = 'CONSENSUS: <b>FAILED — ALL NODES UNREACHABLE</b>';
      logEl.appendChild(verdictDiv);
      magiLabel.style.fill = 'var(--red)';
      return;
    }
    const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    const approve = avg >= 50;
    verdictDiv.className = 'verdict-line ' + (approve ? 'approve' : 'reject');
    verdictDiv.innerHTML = 'CONSENSUS: <b>' + splitLabel(avg) + ' — ' + (approve ? 'APPROVED' : 'REJECTED') + '</b> &nbsp;(' + valid.length + '/3 reporting)';
    logEl.appendChild(verdictDiv);
    logEl.scrollTop = logEl.scrollHeight;
    magiLabel.style.fill = approve ? '#57e0c2' : 'var(--red)';
    magiLabel.style.filter = 'drop-shadow(0 0 8px ' + (approve ? 'rgba(87,224,194,.8)' : 'rgba(255,43,31,.8)') + ')';
  }

  async function runDeliberation() {
    const proposal = questionEl.value.trim();
    if (!proposal || running) { questionEl.focus(); return; }
    running = true;
    questionEl.disabled = true;
    runHint.textContent = '[DELIBERATING…]';
    runHint.className = 'run-hint';
    infobox.classList.add('pulse');
    roMode.textContent = 'EX_MODE:ON';
    roPri.textContent = 'PRIORITY:AAA*';
    magiLabel.style.fill = '';
    magiLabel.style.filter = '';

    logEl.innerHTML = '';
    ['melchior', 'balthasar', 'casper'].forEach(k => {
      setPanel(k, '');
      setStatus(k, personas[k].desc.split(' — ')[0]);
      setPct(k, null);
      personaState[k] = { status: 'standby', pct: null, reasoning: null };
    });

    const keys = Object.keys(personas);
    const votes = await Promise.all(keys.map(k => askPersona(k, proposal)));
    finalize(votes);

    infobox.classList.remove('pulse');
    roMode.textContent = 'EX_MODE:OFF';
    roPri.textContent = 'PRIORITY:AAA';
    runHint.textContent = '[ENTER TO RUN]';
    runHint.className = 'run-hint ready';
    questionEl.disabled = false;
    running = false;
  }

  document.querySelectorAll('.persona-group').forEach(g => {
    const key = g.dataset.key;
    g.addEventListener('mouseenter', () => showTooltip(key));
    g.addEventListener('mousemove', positionTooltip);
    g.addEventListener('mouseleave', hideTooltip);
  });

  questionEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runDeliberation(); }
  });
  questionEl.addEventListener('input', () => {
    runHint.className = questionEl.value.trim() ? 'run-hint ready' : 'run-hint';
  });