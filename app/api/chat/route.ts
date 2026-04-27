import { NextRequest, NextResponse } from "next/server";
import { chat, ChatMessage, PolicyAttachment } from "@/lib/llm";
import { buildSystemPromptForText, buildSystemPromptForPdf } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatRequestBody = {
  messages: ChatMessage[];
  policyName?: string;
  // Either policy text (default/uploaded txt or md)...
  policy?: string;
  // ...or PDF as base64 (uploaded PDF, processed natively by Gemini)
  policyPdfBase64?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const { messages, policy, policyPdfBase64, policyName } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    let systemPrompt: string;
    let attachment: PolicyAttachment | undefined;

    if (policyPdfBase64) {
      systemPrompt = buildSystemPromptForPdf(policyName);
      attachment = { kind: "pdf", base64: policyPdfBase64 };
    } else if (policy && policy.trim().length >= 50) {
      const safePolicy = policy.length > 500_000 ? policy.slice(0, 500_000) : policy;
      systemPrompt = buildSystemPromptForText(safePolicy, policyName);
      attachment = { kind: "text", text: safePolicy };
    } else {
      return NextResponse.json(
        { error: "Either policy text or policyPdfBase64 is required" },
        { status: 400 }
      );
    }

    const response = await chat(systemPrompt, messages, attachment);

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    return NextResponse.json({ reply: response.text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/chat] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
