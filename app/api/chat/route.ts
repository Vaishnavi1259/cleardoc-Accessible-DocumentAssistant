import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const maskedText = body.maskedText || "";
    const question = body.question || "";
    const language = body.language || "English";
    const history = body.history || [];

    if (!maskedText.trim()) {
      return NextResponse.json(
        { error: "No document text provided" },
        { status: 400 }
      );
    }

    if (!question.trim()) {
      return NextResponse.json(
        { error: "No question provided" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is missing" },
        { status: 500 }
      );
    }

    const previousMessages = history
      .slice(-6)
      .map((message: any) => ({
        role:
          message.role === "assistant"
            ? "assistant"
            : "user",
        content: message.text || "",
      }));

    const systemPrompt = `
You are ClearDoc, an accessible document question-answering assistant.

Answer the user's question using ONLY the document provided below.

Rules:
- Do not use outside information.
- Do not invent facts.
- If the answer is not present in the document, clearly say that it is not stated in the document.
- Never reconstruct masked personal information.
- Keep answers simple and easy to understand.
- Use the requested language: ${language}.
- If useful, quote a short relevant part of the document.
- Do not reveal private information hidden behind placeholders.

Document:
${maskedText}
`;

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...previousMessages,
      {
        role: "user",
        content: question,
      },
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages,
          temperature: 0.2,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq Chat API error:", JSON.stringify(data));

      return NextResponse.json(
        {
          error:
            data?.error?.message ||
            "Groq API request failed",
        },
        { status: response.status }
      );
    }

    const answer =
      data?.choices?.[0]?.message?.content;

    if (!answer) {
      return NextResponse.json(
        { error: "No answer received from AI" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      answer,
      quote: "",
    });
  } catch (error) {
    console.error("Chat route error:", error);

    return NextResponse.json(
      { error: "Failed to answer question" },
      { status: 500 }
    );
  }
}