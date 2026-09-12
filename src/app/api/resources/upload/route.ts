/**
 * POST /api/resources/upload
 * Upload a file (and optional thumbnail) to OnyxBase storage.
 * No image size restriction — full-resolution uploads supported.
 *
 * Auth required.
 * Form fields:
 *   - file (required): File | Blob
 *   - thumbnail (optional): File | Blob
 *   - label (optional): string
 *
 * Returns:
 *   { ok: true, fileId, url, thumbnailFileId?, thumbnailUrl? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { uploadFile, getFileUrl } from '@/lib/onyxbase';

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const thumbnail = formData.get('thumbnail');
    const label = formData.get('label');

    if (!file || !(file instanceof File) && !(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid "file" field' },
        { status: 400 }
      );
    }

    const fileName = file instanceof File ? file.name : `upload-${Date.now()}`;
    const mimeType = file instanceof File ? file.type : 'application/octet-stream';
    const labelStr = typeof label === 'string' ? label : undefined;

    const uploaded = await uploadFile(file, fileName, mimeType, labelStr);
    if (!uploaded || !uploaded.fileId) {
      return NextResponse.json(
        { ok: false, error: 'Failed to upload file to OnyxBase' },
        { status: 500 }
      );
    }

    const response: any = {
      ok: true,
      fileId: uploaded.fileId,
      url: uploaded.url || getFileUrl(uploaded.fileId),
      fileName: uploaded.fileName || fileName,
      mimeType: uploaded.mimeType || mimeType,
      size: uploaded.size,
    };

    // Optional thumbnail upload
    if (thumbnail && (thumbnail instanceof File || thumbnail instanceof Blob)) {
      const thumbName = thumbnail instanceof File ? thumbnail.name : `thumbnail-${Date.now()}`;
      const thumbMime = thumbnail instanceof File ? thumbnail.type : 'image/jpeg';
      const thumbUploaded = await uploadFile(thumbnail, thumbName, thumbMime, `${labelStr || fileName}-thumb`);
      if (thumbUploaded && thumbUploaded.fileId) {
        response.thumbnailFileId = thumbUploaded.fileId;
        response.thumbnailUrl = thumbUploaded.url || getFileUrl(thumbUploaded.fileId);
      }
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('[resources/upload] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Upload failed' },
      { status: 500 }
    );
  }
}
