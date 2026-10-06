import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a document comparison assistant. Compare ONLY the two document texts provided. Do not use outside knowledge and do not guess. Placeholders like [NAME_1] or [ACCOUNT_1] stand for hidden private information; the same placeholder in both documents means the same underlying value. NEVER try to guess or reconstruct hidden values. Never invent dates, amounts, names, or requirements. If something is not clearly in the documents, leave it out. Use simple, plain language (6th-8th grade reading level). Write all text values in the requested language, but keep JSON keys in English. Return ONLY valid JSON, with no markdown fences and no extra text. Use empty arrays for sections with no differences.

Return exactly this JSON shape:
{
  "summary": "2-3 sentence plain-language summary of what changed",
  "change_level": "No major change | Minor changes | Important changes | Critical changes",
  "added": [],
  "removed": [],
  "changed_values": [{ "item": "", "previous": "", "current": "" }],
  "changed_deadlines": [{ "item": "", "previous": "", "current": "" }],
  "changed_actions": [{ "item": "", "previous": "", "current": "" }],
  "other_differences": [],
  "pay_attention": []
}`;

const LEVELS = [
  "No major change",
  "Minor changes",
  "Important changes",
  "Critical changes",
] as const;

function parseResult(content: string) {
  const unfenced = content.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
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
      end = index;
      break;
    }
  }
  if (end < start) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const strings = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const rows = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        item: typeof item.item === "string" ? item.item : "",
        previous: typeof item.previous === "string" ? item.previous : "",
        current: typeof item.current === "string" ? item.current : "",
      }))
    : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    change_level: LEVELS.includes(parsed.change_level as typeof LEVELS[number])
      ? parsed.change_level
      : "No major change",
    added: strings(parsed.added),
    removed: strings(parsed.removed),
    changed_values: rows(parsed.changed_values),
    changed_deadlines: rows(parsed.changed_deadlines),
    changed_actions: rows(parsed.changed_actions),
    other_differences: strings(parsed.other_differences),
    pay_attention: strings(parsed.pay_attention),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const { previousText, currentText } = input;
  if (typeof previousText !== "string" || typeof currentText !== "string") {
    return NextResponse.json({ error: "Both document texts must be strings." }, { status: 400 });
  }
  if (!previousText.trim() || !currentText.trim()) {
    return NextResponse.json({ error: "Both documents need text before comparison." }, { status: 400 });
  }
  if (previousText.length > 12000 || currentText.length > 12000) {
    return NextResponse.json({ error: "Each document must be 12,000 characters or fewer." }, { status: 413 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Document comparison is not configured." }, { status: 500 });
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
              language: typeof input.language === "string" ? input.language : "English",
              previousText,
              currentText,
              localHints: input.localHints && typeof input.localHints === "object" ? input.localHints : {},
            }),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "The comparison service is unavailable. Please try again." }, { status: 502 });
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return NextResponse.json({ error: "Could not compare these documents. Please try again." }, { status: 502 });
    }
    const result = parseResult(content);
    if (!result) {
      return NextResponse.json({ error: "Could not compare these documents. Please try again." }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "The comparison service is unavailable. Please try again." }, { status: 502 });
  }
}
