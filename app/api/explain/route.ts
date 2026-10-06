import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are ClearDoc, an accessible document assistant. Explain ONLY the provided selected text in simple everyday language. Do not add information that is not present in the selected text. Do not guess missing information. If the selected text is unclear, say that it is unclear rather than inventing an explanation. Preserve privacy placeholders exactly as provided, including placeholders such as [NAME_1], [EMAIL_1], [PHONE_1], [AADHAAR_1], and [PAN_1]. Respect the requested language and reading level. For legal, medical, financial, or government content, explain the wording but do not present the explanation as professional advice. Return ONLY valid JSON with exactly one field: {"explanation":"Simple explanation of the selected text."}`;

function extractExplanation(content: string): string | null {
  const unfenced = content.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < unfenced.length; index++) {
    const character = unfenced[index];
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
        const parsed: unknown = JSON.parse(unfenced.slice(start, index + 1));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const explanation = (parsed as Record<string, unknown>).explanation;
        return typeof explanation === "string" && explanation.trim() ? explanation : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid explanation request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid explanation request." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (typeof input.selectedText !== "string" || !input.selectedText.trim()) {
    return NextResponse.json({ error: "Select some document text first." }, { status: 400 });
  }
  if (input.selectedText.length > 12000) {
    return NextResponse.json({ error: "Selected text is too long to explain." }, { status: 413 });
  }

  const language = typeof input.language === "string" && ["English", "Telugu", "Hindi"].includes(input.language)
    ? input.language
    : "English";
  const level = typeof input.level === "string" && ["simple", "standard", "detailed"].includes(input.level.toLowerCase())
    ? input.level.toLowerCase()
    : "simple";
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The explanation service is unavailable." }, { status: 503 });
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
            content: JSON.stringify({
              selectedText: input.selectedText,
              language,
              level,
            }),
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "The explanation service is unavailable." }, { status: 502 });
    }
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    const explanation = typeof content === "string" ? extractExplanation(content) : null;
    if (!explanation) {
      return NextResponse.json({ error: "Could not explain this section. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ explanation });
  } catch {
    return NextResponse.json({ error: "The explanation service is unavailable." }, { status: 502 });
  }
}
