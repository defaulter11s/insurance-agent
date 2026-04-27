import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fetches a previously-uploaded Blob and either:
 *  - Returns text directly for .txt/.md
 *  - Returns the PDF as base64 for the chat route to send to Gemini
 *
 * No PDF parsing happens here. Gemini handles PDF understanding natively.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string; name?: string };
    const { url, name } = body;

    if (!url || !name) {
      return NextResponse.json(
        { error: "url and name are required" },
        { status: 400 }
      );
    }

    if (
      !url.includes("public.blob.vercel-storage.com") &&
      !url.includes(".vercel-storage.com")
    ) {
      return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
    }

    const fileName = name.toLowerCase();
    const fileRes = await fetch(url);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `Could not fetch uploaded file: ${fileRes.status}` },
        { status: 500 }
      );
    }
    const arrayBuffer = await fileRes.arrayBuffer();
    const fileSize = arrayBuffer.byteLength;

    // Always clean up the Blob after fetching
    try {
      await del(url);
    } catch (delErr) {
      console.warn("[api/upload] failed to delete blob:", delErr);
    }

    // Plain text and markdown
    if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
      const text = Buffer.from(arrayBuffer).toString("utf-8");
      if (text.trim().length < 50) {
        return NextResponse.json(
          { error: "File is too short (minimum 50 characters)." },
          { status: 400 }
        );
      }
      return NextResponse.json({
        kind: "text",
        text,
        name,
        characters: text.length,
      });
    }

    // PDF — pass through as base64. Gemini extracts content natively.
    if (fileName.endsWith(".pdf")) {
      // Gemini's inline data limit is 20 MB. The file is base64-encoded for
      // transit, which inflates size by ~33%. So practical raw limit is ~15 MB.
      const MAX_PDF_BYTES = 15 * 1024 * 1024;
      if (fileSize > MAX_PDF_BYTES) {
        return NextResponse.json(
          {
            error:
              "PDF too large. Please upload a PDF under 15 MB, or extract the text and upload as .txt.",
          },
          { status: 400 }
        );
      }
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return NextResponse.json({
        kind: "pdf",
        base64,
        name,
        bytes: fileSize,
      });
    }

    return NextResponse.json(
      { error: "Unsupported file type. Upload .pdf, .txt, or .md files." },
      { status: 400 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/upload] error:", msg);
    return NextResponse.json(
      { error: `Upload processing failed: ${msg}` },
      { status: 500 }
    );
  }
}
