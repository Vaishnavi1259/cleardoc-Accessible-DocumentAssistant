import { NextResponse } from "next/server";

const SIGNAL_TYPES = [
  "urgency",
  "payment",
  "sensitive_info",
  "contact",
  "link",
  "mismatch",
  "contradiction",
  "unusual_request",
] as const;
const SEVERITIES = ["low", "medium", "high"] as const;
const STATUSES = ["low_concern", "needs_verification", "multiple_risk_signals"] as const;

const SYSTEM_PROMPT = `You are ClearDoc's document safety checker. Analyze ONLY the supplied masked document text. Do not use outside assumptions, invent facts, or declare that a document is fake or genuine. Do not give a fraud percentage.

Look only for these potential indicators: (1) urgency or pressure, (2) payment requests, (3) requests for sensitive information, (4) contact details or links the document asks the user to use, (5) organization/contact mismatch, (6) internal contradictions in dates, amounts, names, or reference numbers, and (7) unusual instructions such as installing unknown software, sharing a screen, granting remote access, secrecy, or bypassing normal procedures.

Important: a deadline alone is NOT suspicious; a phone number alone is NOT suspicious; a payment request alone is NOT proof of fraud; a URL alone is NOT proof of fraud. Do not flag those alone. Contact information that the document asks the user to use can be marked for independent verification, but never call it fraudulent. An organization/contact mismatch must be based on details in the supplied text and phrased as "Contact information may require verification." Every signal needs short evidence copied exactly from the document. Keep masked placeholders exactly as provided; never guess their hidden values. If nothing merits attention, use low_concern and no signals. Use needs_verification for one signal and multiple_risk_signals for multiple distinct signals. Keep summaries, evidence, explanations, and precautions brief. Write all text values in the requested language; keep JSON keys and enum values in English.

Return ONLY a JSON object with exactly these fields and no extra fields:
{
  "status": "low_concern | needs_verification | multiple_risk_signals",
  "summary": "short explanation",
  "signals": [{
    "type": "urgency | payment | sensitive_info | contact | link | mismatch | contradiction | unusual_request",
    "severity": "low | medium | high",
    "title": "short title",
    "evidence": "exact short text copied from the document, without added quotation marks",
    "why": "why this deserves attention",
    "precaution": "what the user should do"
  }],
  "before_you_act": ["short precaution"]
}`;

function extractObject(content: string): Record<string, unknown> | null {
  const text = content.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        const result = JSON.parse(text.slice(start, index + 1));
        return result && typeof result === "object" && !Array.isArray(result) ? result : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeResult(value: Record<string, unknown>, maskedText: string) {
  if (!STATUSES.includes(value.status as typeof STATUSES[number]) || typeof value.summary !== "string") return null;
  if (!Array.isArray(value.signals) || !Array.isArray(value.before_you_act)) return null;

  const signals = [];
  for (const signal of value.signals) {
    if (!signal || typeof signal !== "object" || Array.isArray(signal)) return null;
    const item = signal as Record<string, unknown>;
    if (
      !SIGNAL_TYPES.includes(item.type as typeof SIGNAL_TYPES[number]) ||
      !SEVERITIES.includes(item.severity as typeof SEVERITIES[number]) ||
      typeof item.title !== "string" ||
      typeof item.evidence !== "string" ||
      !item.evidence.trim() ||
      !maskedText.includes(item.evidence) ||
      typeof item.why !== "string" ||
      typeof item.precaution !== "string"
    ) return null;
    signals.push({
      type: item.type,
      severity: item.severity,
      title: item.title,
      evidence: item.evidence,
      why: item.why,
      precaution: item.precaution,
    });
  }

  if (!value.before_you_act.every((item) => typeof item === "string")) return null;
  return {
    status: value.status,
    summary: value.summary,
    signals,
    before_you_act: value.before_you_act,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid safety-check request." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid safety-check request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.maskedText !== "string" || !input.maskedText.trim()) {
    return NextResponse.json({ error: "Masked document text is required." }, { status: 400 });
  }
  if (input.maskedText.length > 12000) {
    return NextResponse.json({ error: "Document text is too long for a safety check." }, { status: 413 });
  }
  const language = typeof input.language === "string" && ["English", "Telugu", "Hindi"].includes(input.language)
    ? input.language
    : "English";
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Safety Check temporarily unavailable." }, { status: 503 });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({ language, document: input.maskedText }),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Safety Check temporarily unavailable." }, { status: 502 });
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return NextResponse.json({ error: "Safety Check temporarily unavailable." }, { status: 502 });
    }
    const parsed = extractObject(content);
    const result = parsed && normalizeResult(parsed, input.maskedText);
    if (!result) {
      return NextResponse.json({ error: "Safety Check temporarily unavailable." }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Safety Check temporarily unavailable." }, { status: 502 });
  }
}
