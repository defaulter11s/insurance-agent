import { GoogleGenerativeAI, Part } from "@google/generative-ai";

/**
 * LLM Client — abstracted so you can swap to Anthropic, OpenAI, or others
 * by changing this file alone. Currently uses Google Gemini (free tier).
 */

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!apiKey) {
  console.warn("[llm] GEMINI_API_KEY not set — API routes will fail until configured");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LLMResponse = {
  text: string;
  error?: string;
};

export type PolicyAttachment =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string };

/**
 * Send a chat completion. The systemPrompt becomes the system instruction.
 * If policyAttachment is a PDF, it's appended to the first user message as
 * inlineData so Gemini can parse it natively.
 *
 * Gemini quirks handled here:
 *  - History must start with a "user" turn (we strip leading assistants)
 *  - History must strictly alternate user/model (we collapse same-role pairs)
 */
export async function chat(
  systemPrompt: string,
  messages: ChatMessage[],
  policyAttachment?: PolicyAttachment
): Promise<LLMResponse> {
  if (!genAI) {
    return {
      text: "",
      error: "GEMINI_API_KEY is not configured. Set it in Vercel env vars.",
    };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 600,
      },
    });

    const cleaned = stripLeadingAssistant(messages);
    if (cleaned.length === 0) {
      return { text: "", error: "No user message to send" };
    }

    const last = cleaned[cleaned.length - 1];
    if (last.role !== "user") {
      return { text: "", error: "Last message must be from user" };
    }

    // Build history in Gemini's format
    const history = collapseAlternating(cleaned.slice(0, -1)).map((m, idx) => {
      const role = m.role === "assistant" ? "model" : "user";
      const parts: Part[] = [{ text: m.content }];

      // For PDF policies, attach the PDF to the FIRST user turn so Gemini
      // can reference it throughout the conversation. Only on the first turn —
      // sending it every turn would waste tokens.
      if (
        idx === 0 &&
        role === "user" &&
        policyAttachment?.kind === "pdf"
      ) {
        parts.push({
          inlineData: {
            mimeType: "application/pdf",
            data: policyAttachment.base64,
          },
        });
      }

      return { role, parts };
    });

    // If the conversation has no prior turns, attach the PDF to the current message
    const lastParts: (string | Part)[] = [last.content];
    if (
      history.length === 0 &&
      policyAttachment?.kind === "pdf"
    ) {
      lastParts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: policyAttachment.base64,
        },
      });
    }

    const chatSession = model.startChat({ history });
    const result = await chatSession.sendMessage(lastParts);
    const text = result.response.text();

    return { text };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown LLM error";
    console.error("[llm] error:", msg);
    return { text: "", error: msg };
  }
}

function stripLeadingAssistant(messages: ChatMessage[]): ChatMessage[] {
  let i = 0;
  while (i < messages.length && messages[i].role === "assistant") {
    i++;
  }
  return messages.slice(i);
}

function collapseAlternating(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = `${prev.content}\n\n${m.content}`.trim();
    } else {
      out.push({ ...m });
    }
  }
  return out;
}
