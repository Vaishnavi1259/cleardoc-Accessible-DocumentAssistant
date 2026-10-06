import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const maskedText = body.maskedText || "";
    const level = body.level || "standard";
    const language = body.language || "English";

    if (!maskedText.trim()) {
      return NextResponse.json(
        { error: "No document text provided" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is missing from .env.local" },
        { status: 500 }
      );
    }

    const prompt = `
You are ClearDoc, an accessible document assistant.

Analyze the following document.

IMPORTANT:
- Use ONLY information present in the document.
- Never invent information.
- Never guess masked personal information.
- Keep the explanation simple.
- Preserve exact amounts and dates.
- Identify important actions and deadlines.

For critical_details, extract specific facts.

If the document says:
"Please pay Rs. 5000 before 30 September 2026. For help contact [PHONE_1]. Email: [EMAIL_1]"

then critical_details should contain:
"Amount due: Rs. 5000"
"Payment deadline: 30 September 2026"
"Action required: Pay Rs. 5000 before 30 September 2026"
"Contact for help: [PHONE_1] or [EMAIL_1]"

Do not write vague statements such as:
"Pay the amount"
"Contact the bank if needed"
"Take necessary action"

User reading level: ${level}
Requested language: ${language}

Return ONLY valid JSON in exactly this structure:

{
  "document_type": "string",
  "plain_version": "string",
  "critical_details": [
    "string"
  ],
  "unclear_parts": [
    "string"
  ],
  "needs_disclaimer": false
}

Document:

${maskedText}
`;

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          response_format: {
            type: "json_object",
          },
        }),
      }
    );

    const groqText = await groqResponse.text();

    console.log("Groq status:", groqResponse.status);
    console.log("Groq response:", groqText);

    if (!groqResponse.ok) {
      return NextResponse.json(
        {
          error: `Groq API error (${groqResponse.status}): ${groqText}`,
        },
        { status: 500 }
      );
    }

    let groqData;

    try {
      groqData = JSON.parse(groqText);
    } catch {
      return NextResponse.json(
        {
          error: "Groq returned an invalid response.",
        },
        { status: 500 }
      );
    }

    const content =
      groqData?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        {
          error: "Groq returned no analysis.",
        },
        { status: 500 }
      );
    }

    let result;

    try {
      result = JSON.parse(content);
    } catch {
      console.log("AI content was:", content);

      return NextResponse.json(
        {
          error: "AI returned invalid JSON.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown server error",
      },
      { status: 500 }
    );
  }
}