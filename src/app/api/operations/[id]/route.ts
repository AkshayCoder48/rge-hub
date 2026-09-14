/**
 * GET /api/operations/[id]
 * Operation status reconciliation endpoint (PRD §6, §22, §24).
 *
 * A client that lost a mutation response (timeout, navigation, network)
 * polls this endpoint to learn the DEFINITIVE state of the work instead
 * of guessing "failed". Returns 200 with the operation body regardless of
 * the operation's own status (success/failed are both definitive states);
 * 404 only when the id is unknown (expired or never existed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperation, operationToBody } from '@/lib/operations';
import { newRequestId } from '@/lib/api-contract';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  try {
    const { id } = await params;
    const op = await getOperation(id);
    if (!op) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Unknown operation id. If you just performed an action, retry it — idempotency prevents duplicates.',
          },
          requestId,
        },
        { status: 404, headers: { 'x-request-id': requestId } }
      );
    }
    return NextResponse.json(
      { success: true, data: operationToBody(op), requestId, durationMs: Date.now() - t0 },
      { headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[operations/get] error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to load operation status' },
        requestId,
      },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}
