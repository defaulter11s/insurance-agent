import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Issues a short-lived signed URL the browser uses to upload directly
 * to Vercel Blob. This bypasses Vercel's 4.5 MB function-body limit.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: [
            "application/pdf",
            "text/plain",
            "text/markdown",
          ],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB
          tokenPayload: JSON.stringify({ pathname }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("[blob] upload completed:", blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown blob error";
    console.error("[api/upload-token] error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
