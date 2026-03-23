const Anthropic = require('@anthropic-ai/sdk').default;
const { TIER_LIMITS } = require('../services/tierLimits');

const anthropic = new Anthropic(); // Uses ANTHROPIC_API_KEY env var

// In-memory rate limiting for starter tier
const rateLimits = new Map();

function getRateKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `${userId}:${today}`;
}

function checkRateLimit(userId, tier) {
  const limit = TIER_LIMITS[tier]?.maxChatMessagesPerDay;
  if (!limit || limit === -1) return true; // unlimited

  const key = getRateKey(userId);
  const current = rateLimits.get(key) || 0;
  if (current >= limit) return false;
  rateLimits.set(key, current + 1);

  // Clean old entries periodically
  if (rateLimits.size > 10000) {
    const today = new Date().toISOString().split('T')[0];
    for (const [k] of rateLimits) {
      if (!k.endsWith(today)) rateLimits.delete(k);
    }
  }

  return true;
}

function buildSystemPrompt(context, aiChatTier) {
  let prompt = `You are an expert thin-film optical coating designer and consultant working within OptiCoat Designer, a web-based thin-film optical coating design and optimization tool.

Your expertise includes:
- Transfer matrix method for multilayer thin-film calculations
- Material selection and properties: SiO2, TiO2, ZrO2, Ta2O5, Nb2O5, HfO2, Al2O3, MgF2, Y2O3, SiO
- Dispersion models (Cauchy, Sellmeier) and refractive index data
- Anti-reflection (AR) coatings, dielectric mirrors, bandpass filters, edge filters, notch filters, beam splitters, cold/hot mirrors
- Quarter-wave optical thickness (QWOT) design principles
- Color science: CIE 1931 XYZ, L*a*b*, Delta E calculations
- Manufacturing: stress management, IAD effects, packing density, tooling factors, deposition rate
- Angle-dependent performance: Snell's law, s-polarization, p-polarization splitting

OptiCoat Designer features you can reference:
- Layer stack editor with drag-and-drop reordering
- Multi-stack comparison (overlay multiple designs on one chart)
- Reflectivity/Transmission/Absorption chart (default 350-800nm range)
- Admittance loci visualization
- E-field distribution plots
- Color simulation (CIE L*a*b* under D65, D50, A, F2, F11 illuminants)
- Design Assistant optimizer with target mode, reverse engineering from CSV, and color target mode
- Factor/Shift tools for uniform thickness scaling
- Recipe tracking for manufacturing runs

Be concise, practical, and specific. When suggesting designs, give concrete layer thicknesses in nanometers. When referencing the user's current design, be specific about which layers or settings you're referring to.`;

  // Only include design context for 'full' tier (Professional/Enterprise)
  if (aiChatTier === 'full' && context) {
    prompt += '\n\n--- CURRENT DESIGN CONTEXT ---\n';

    if (context.substrate) {
      prompt += `Substrate: ${context.substrate.material || 'Glass'} (n=${context.substrate.n || 1.52})\n`;
    }
    if (context.incident) {
      prompt += `Incident medium: ${context.incident.material || 'Air'} (n=${context.incident.n || 1.0})\n`;
    }
    if (context.layers && context.layers.length > 0) {
      prompt += `\nLayer stack (from substrate to surface):\n`;
      context.layers.forEach((layer, i) => {
        prompt += `  ${i + 1}. ${layer.material} — ${layer.thickness} nm\n`;
      });
    } else {
      prompt += `\nLayer stack: Empty (no layers added yet)\n`;
    }
    if (context.wavelengthRange) {
      prompt += `\nWavelength range: ${context.wavelengthRange.min}-${context.wavelengthRange.max} nm\n`;
    }
    if (context.targets && context.targets.length > 0) {
      prompt += `\nDesign targets:\n`;
      context.targets.forEach((t, i) => {
        prompt += `  ${i + 1}. ${t.wavelengthMin}-${t.wavelengthMax} nm: R=${t.reflectivityMin}-${t.reflectivityMax}%\n`;
      });
    }
    if (context.materials && context.materials.length > 0) {
      prompt += `\nAvailable materials: ${context.materials.join(', ')}\n`;
    }
    if (context.colorData) {
      const L = Number(context.colorData.L);
      const a = Number(context.colorData.a);
      const b = Number(context.colorData.b);
      if (!isNaN(L)) prompt += `\nReflected color: L*=${L.toFixed(1)}, a*=${a.toFixed(1)}, b*=${b.toFixed(1)}\n`;
    }
  }

  return prompt;
}

// POST /api/chat
const chatHandler = async (req, res) => {
  console.log('[CHAT] Request received, body keys:', Object.keys(req.body || {}));
  try {
    const userTier = req.user?.tier || 'free';
    const tierConfig = TIER_LIMITS[userTier];
    console.log('[CHAT] Tier:', userTier, 'aiChat:', tierConfig?.aiChat);

    // AI chat requires professional or enterprise tier (aiChat: 'full')
    if (!tierConfig?.aiChat || tierConfig.aiChat !== 'full') {
      return res.status(403).json({
        error: 'Lumi AI is available for Professional and Enterprise plans only. Please upgrade to access this feature.',
        feature: 'aiChat',
      });
    }

    // Rate limiting for non-unlimited tiers
    if (!checkRateLimit(req.user.id, userTier)) {
      return res.status(429).json({
        error: `Daily message limit reached (${tierConfig.maxChatMessagesPerDay} messages/day). Upgrade your plan for unlimited access.`,
      });
    }

    const { messages, context } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const systemPrompt = buildSystemPrompt(context, tierConfig.aiChat);

    // Set SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Stream from Claude API
    const stream = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('[CHAT] Top-level error:', error.message);
    console.error('[CHAT] Stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    } else {
      try { res.end(); } catch (_) { /* already closed */ }
    }
  }
};

module.exports = { chatHandler };
