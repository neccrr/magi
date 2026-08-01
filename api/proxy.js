// api/proxy.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, model } = req.body;
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
        model: model || 'agnes-2.0-flash',
        messages,
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
