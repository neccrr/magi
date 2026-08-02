// api/deliberate.js
const PERSONAS = {
  melchior: {
    label: 'MELCHIOR-1',
    system: `You are MELCHIOR-1, the "Scientist" personality within the MAGI triune decision system. You evaluate proposals purely through logic, evidence, feasibility, and risk analysis. You are dispassionate and analytical, weighing costs, probabilities, and second-order consequences. You are skeptical of appeals to emotion or tradition. Respond ONLY with strict JSON, no markdown fences, no preamble: {"approve_pct": <integer 0-100, your confidence the proposal should be approved>, "reasoning": "2-3 sentences in character, terse and analytical"}`
  },
  balthasar: {
    label: 'BALTHASAR-2',
    system: `You are BALTHASAR-2, the "Mother" personality within the MAGI triune decision system. You evaluate proposals through protectiveness, care, and long-term wellbeing of everyone affected, especially the vulnerable. You weigh nurture, safety, and consequences for relationships and people over pure logic. Respond ONLY with strict JSON, no markdown fences, no preamble: {"approve_pct": <integer 0-100, your confidence the proposal should be approved>, "reasoning": "2-3 sentences in character, warm but firm"}`
  },
  casper: {
    label: 'CASPER-3',
    system: `You are CASPER-3, the "Woman" personality within the MAGI triune decision system. You evaluate proposals through personal desire, intuition, self-interest, and human ambition. You ask what is actually wanted, what feels right, and what serves the individual, not just the collective. You are the most willing to take a bold or unconventional position. Respond ONLY with strict JSON, no markdown fences, no preamble: {"approve_pct": <integer 0-100, your confidence the proposal should be approved>, "reasoning": "2-3 sentences in character, direct and personal"}`
  }
};

const DEFAULT_MODEL = 'agnes-2.0-flash';

function extractJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a !== -1 && b !== -1 && b > a) {
      return JSON.parse(cleaned.substring(a, b + 1));
    }
    throw new Error('No JSON object found in model response');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key, proposal } = req.body || {};
  const persona = PERSONAS[key];
  if (!persona) {
    return res.status(400).json({ error: 'Unknown persona key' });
  }
  if (!proposal || typeof proposal !== 'string' || !proposal.trim()) {
    return res.status(400).json({ error: 'Missing proposal' });
  }

  const apiKey = process.env.BYNARA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server missing BYNARA_API_KEY environment variable' });
  }

  try {
    const response = await fetch('https://router.bynara.id/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: persona.system },
          { role: 'user', content: 'Proposal for deliberation:\n\n' + proposal }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data.error?.message || data.error || ('HTTP ' + response.status);
      return res.status(response.status).json({ error: msg });
    }

    const raw = data.choices?.[0]?.message?.content || '';
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from model' });
    }

    const parsed = extractJSON(raw);
    let pct = Math.round(Number(parsed.approve_pct));
    if (Number.isNaN(pct)) pct = 50;
    pct = Math.max(0, Math.min(100, pct));

    return res.status(200).json({
      label: persona.label,
      pct,
      reasoning: parsed.reasoning || '(no reasoning)'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}