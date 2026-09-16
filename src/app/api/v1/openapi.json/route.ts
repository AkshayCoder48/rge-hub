/**
 * GET /api/v1/openapi.json — machine-readable OpenAPI 3.1 spec for the
 * whole public API surface (no auth). Powers tooling, codegen, and the
 * MCP server's tool descriptions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { newRequestId } from '@/lib/api-contract';
import { absoluteUrl } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const RESOURCE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'xml_ab12cd34ef56gh78' },
    type: { type: 'string', enum: ['image', 'clip', 'xml'] },
    ownerId: { type: 'string' },
    ownerName: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    fileId: { type: 'string' },
    fileName: { type: 'string' },
    mimeType: { type: 'string' },
    size: { type: 'number' },
    extension: { type: 'string' },
    url: { type: 'string', description: 'Download URL' },
    fileUrl: { type: 'string', description: 'Stable on-domain file URL (302 to storage)' },
    apiUrl: { type: 'string', description: 'This resource on the public API' },
    tags: { type: 'array', items: { type: 'string' } },
    category: { type: 'string' },
    published: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const spec = (origin: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'RGE Hub Public API',
    version: '1.0.0',
    description:
      'Public API for RGE Hub — editing resources (images, clips, files/XMLs), creators, and the community feed. Authenticate with your account API key (Settings → Security → Reveal API key) via `Authorization: Bearer <key>` or `X-API-Key: <key>`.',
    contact: { name: 'RGE Hub', url: origin },
  },
  servers: [{ url: origin }],
  security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Account API key (kv_live_…)' },
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Account API key (kv_live_…)' },
    },
  },
  paths: {
    '/api/v1/health': {
      get: {
        summary: 'Instance health',
        description: 'Liveness of the hub + storage engine. No auth.',
        security: [],
        responses: {
          '200': {
            description: 'Health report',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    components: {
                      type: 'object',
                      properties: {
                        api: { type: 'object', properties: { ok: { type: 'boolean' } } },
                        storage: { type: 'object', properties: { ok: { type: 'boolean' } } },
                      },
                    },
                    time: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/me': {
      get: {
        summary: 'My account',
        description: 'The authenticated account: profile (safe fields) + upload/follower counts. The natural first call to verify a key.',
        responses: {
          '200': { description: 'Account summary' },
          '401': { description: 'Missing or invalid API key' },
          '404': { description: 'Key valid but no Hub profile (sign in to the Hub once)' },
        },
      },
    },
    '/api/v1/resources': {
      get: {
        summary: 'List my resources',
        description: 'All resources owned by the authenticated account (drafts included).',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['image', 'clip', 'xml'] } },
          { name: 'published', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
        ],
        responses: { '200': { description: 'Resource list' }, '401': { description: 'Missing or invalid API key' } },
      },
      post: {
        summary: 'Create a resource',
        description:
          'Two modes: LINK {url, type?, …} registers an external http(s) link; TEXT {content, fileName?, …} stores a text file (≤2MB) on Hub storage. Both accept title, description, tags, category, published, and clientId (idempotency key — retries return the same resource).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', maxLength: 200 },
                  url: { type: 'string', description: 'http(s) link (link mode)' },
                  content: { type: 'string', description: 'Text file body ≤2MB (text mode)' },
                  type: { type: 'string', enum: ['image', 'clip', 'xml'], description: 'Link mode only — guessed from the URL when omitted' },
                  fileName: { type: 'string' },
                  mimeType: { type: 'string' },
                  description: { type: 'string', maxLength: 2000 },
                  tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
                  category: { type: 'string' },
                  published: { type: 'boolean', default: true },
                  clientId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$', description: 'Idempotency key' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created (or deduped) resource' }, '400': { description: 'Validation error' }, '401': { description: 'Missing or invalid API key' } },
      },
    },
    '/api/v1/resources/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^(img|clip|xml)_[A-Za-z0-9_-]{4,48}$' } }],
      get: {
        summary: 'Get a resource',
        description: 'Detail for one resource. Published: public. Drafts: owner key only.',
        responses: { '200': { description: 'Resource detail' }, '404': { description: 'Not found (or a draft you cannot see)' } },
      },
      patch: {
        summary: 'Update my resource',
        description: 'Owner-only partial update: title, description, tags, category, published.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', maxLength: 200 },
                  description: { type: 'string', maxLength: 2000 },
                  tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
                  category: { type: 'string' },
                  published: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated resource' }, '403': { description: 'Not your resource' }, '404': { description: 'Not found' } },
      },
      delete: {
        summary: 'Delete my resource',
        description: 'Owner-only delete. Idempotent: deleting a missing id succeeds.',
        responses: { '200': { description: 'Deleted' }, '403': { description: 'Not your resource' } },
      },
    },
    '/api/v1/files/{fileId}': {
      parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,128}$' } }],
      get: {
        summary: 'File metadata + URL',
        description: 'Stable on-domain download URL for a stored file. No auth.',
        security: [],
        responses: { '200': { description: 'File metadata + url' } },
      },
    },
    '/api/v1/search': {
      get: {
        summary: 'Search public resources',
        description: 'Full-text search over published resources (title, description, creator, tags). No auth.',
        security: [],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', maxLength: 200 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: { '200': { description: 'Search results' }, '400': { description: 'Missing q' } },
      },
    },
    '/api/v1/community/feed': {
      get: {
        summary: 'Community feed',
        description: 'All published community resources, newest first. No auth.',
        security: [],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }],
        responses: { '200': { description: 'Feed' } },
      },
    },
    '/api/v1/users/{username}': {
      parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9_]{3,32}$' } }],
      get: {
        summary: 'Public creator profile',
        description: 'Profile by username + published resources + follower counts. No auth.',
        security: [],
        responses: { '200': { description: 'Profile + resources' }, '404': { description: 'User not found' } },
      },
    },
  },
  'x-resource-schema': RESOURCE_SCHEMA,
  'x-rate-limits': {
    authenticated: '90 requests / minute / key',
    public: '30-60 requests / minute / IP',
  },
});

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const body = spec(absoluteUrl(request, '').replace(/\/+$/, ''));
  return NextResponse.json(body, {
    headers: { 'x-request-id': requestId, 'Cache-Control': 'public, max-age=300' },
  });
}
