/**
 * POST /api/admin/ingest-tiktok   (header `x-admin-secret: <ADMIN_SECRET>`)
 *
 * Jalon 1 — socle réseau. URL TikTok → mp4 → Cloudinary → caption + champs
 * extraits. NE CRÉE AUCUN bien en base.
 *
 * Body : { url: string }
 * 200  : IngestResult { videoUrl, thumbnailUrl, caption, extracted, source }
 *
 * ⚠️ Runtime Node (child_process/fs/yt-dlp) — tourne en local (`npm run dev`),
 * pas sur le serverless Vercel (yt-dlp absent là-bas).
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { checkAdminSecret } from '@/lib/auth/adminSecret'
import {
  isTikTokUrl,
  downloadTikTok,
  uploadToCloudinary,
  extractInfoFromCaption,
  cleanupDownload,
  type TikTokDownload,
} from '@/lib/services/tiktokIngest'
import type { IngestResult } from '@/lib/admin/tiktokStudioTypes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  if (!checkAdminSecret(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const url = (body as { url?: unknown })?.url
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'url_required' }, { status: 400 })
  }
  if (!isTikTokUrl(url)) {
    return NextResponse.json(
      { error: 'not_tiktok', message: 'Seules les URLs TikTok sont supportées (Instagram hors scope).' },
      { status: 400 },
    )
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 })
  }
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return NextResponse.json({ error: 'missing_cloudinary_config' }, { status: 500 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ① download
  let dl: TikTokDownload
  try {
    dl = await downloadTikTok(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'download_failed', message }, { status: 502 })
  }

  try {
    // ② upload Cloudinary
    let upload
    try {
      upload = await uploadToCloudinary(dl.localPath, dl.prefix)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: 'cloudinary_failed', message }, { status: 502 })
    }

    // ③ extraction caption
    let extracted
    try {
      extracted = await extractInfoFromCaption(dl.caption, anthropic)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: 'extraction_failed', message }, { status: 502 })
    }

    const result: IngestResult = {
      videoUrl: upload.videoUrl,
      thumbnailUrl: upload.thumbnailUrl,
      caption: dl.caption,
      extracted,
      source: {
        videoId: dl.videoId,
        handle: dl.handle,
        webpageUrl: dl.webpageUrl,
      },
    }
    return NextResponse.json(result)
  } finally {
    // Nettoyage local (best-effort) — la vidéo vit désormais sur Cloudinary.
    cleanupDownload(dl)
  }
}
