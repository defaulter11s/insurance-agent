import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fetches a previously-uploaded Blob, extracts text, returns it,
 * and cleans up the Blob.
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

    let result: { text: string; pages?: number } | null = null;

    if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
      const text = Buffer.from(arrayBuffer).toString("utf-8");
      result = { text };
    }

    if (fileName.endsWith(".pdf")) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(arrayBuffer),
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      });

      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      const textChunks: string[] = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ");
        textChunks.push(pageText);
      }

      const text = textChunks.join("\n\n");
      result = { text, pages: numPages };
    }

    try {
      await del(url);
    } catch (delErr) {
      console.warn("[api/upload] failed to delete blob:", delErr);
    }

    if (!result) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload .pdf, .txt, or .md files." },
        { status: 400 }
      );
    }

    if (!result.text || result.text.trim().length < 50) {
      return NextResponse.json(
        {
          error:
            "Could not extract readable text from this file. If it's a scanned PDF, OCR it first and upload the .txt.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      text: result.text,
      name,
      characters: result.text.length,
      pages: result.pages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/upload] error:", msg);
    return NextResponse.json(
      { error: `Upload processing failed: ${msg}` },
      { status: 500 }
    );
  }
}
