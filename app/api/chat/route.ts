import { NextRequest, NextResponse } from "next/server";
import { chat, ChatMessage } from "@/lib/llm";
import { buildSystemPrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 30;

type ChatRequestBody = {
  messages: ChatMessage[];
  policy: string;
  policyName?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const { messages, policy, policyName } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }
    if (!policy || typeof policy !== "string" || policy.trim().length < 50) {
      return NextResponse.json(
        { error: "policy text is required (minimum 50 characters)" },
        { status: 400 }
      );
    }

    const safePolicy = policy.length > 500_000 ? policy.slice(0, 500_000) : policy;
    const systemPrompt = buildSystemPrompt(safePolicy, policyName);

    const response = await chat(systemPrompt, messages);

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
