/**
 * Structured upload error codes (PRD §47 — Error Classification).
 *
 * Every failure in the upload pipeline maps to one of these codes so the
 * UI can show the right recovery action (retry upload vs retry registration)
 * instead of collapsing everything into a generic "Upload failed".
 */

export type UploadErrorCode =
  | 'UPLOAD_NETWORK_ERROR'
  | 'UPLOAD_STORAGE_ERROR'
  | 'UPLOAD_THROTTLED'
  | 'UPLOAD_CANCELLED'
  | 'UPLOAD_TIMEOUT'
  | 'DATABASE_REGISTRATION_ERROR'
  | 'DATABASE_VERIFICATION_ERROR'
  | 'FILE_TYPE_ERROR'
  | 'FILE_SIZE_ERROR'
  | 'AUTH_ERROR'
  | 'UNKNOWN_ERROR';

export const UPLOAD_ERROR_MESSAGES: Record<UploadErrorCode, string> = {
  UPLOAD_NETWORK_ERROR: 'Network error during upload. Check your connection and retry.',
  UPLOAD_STORAGE_ERROR: 'Storage upload failed. The file could not be saved. Please retry.',
  UPLOAD_THROTTLED: 'Storage is busy (rate limited). Please wait a moment and retry.',
  UPLOAD_CANCELLED: 'Upload cancelled.',
  UPLOAD_TIMEOUT: 'Upload timed out. Please retry — your file was not lost.',
  DATABASE_REGISTRATION_ERROR:
    'File uploaded, but resource registration failed. Retry registration — no need to re-upload.',
  DATABASE_VERIFICATION_ERROR:
    'File uploaded, but registration could not be confirmed yet. Retrying…',
  FILE_TYPE_ERROR: 'Unsupported file type.',
  FILE_SIZE_ERROR: 'File is too large for the current storage limit.',
  AUTH_ERROR: 'Authentication required. Please log in and try again.',
  UNKNOWN_ERROR: 'Something went wrong. Please retry.',
};

export function uploadErrorMessage(code: UploadErrorCode, detail?: string): string {
  const base = UPLOAD_ERROR_MESSAGES[code] || UPLOAD_ERROR_MESSAGES.UNKNOWN_ERROR;
  return detail ? `${base} (${detail})` : base;
}

/** Which stage a failure happened in — drives the retry UX. */
export type UploadFailureStage = 'transfer' | 'registration' | 'verification' | 'validation';

export function stageForCode(code: UploadErrorCode): UploadFailureStage {
  switch (code) {
    case 'DATABASE_REGISTRATION_ERROR':
      return 'registration';
    case 'DATABASE_VERIFICATION_ERROR':
      return 'verification';
    case 'FILE_TYPE_ERROR':
    case 'FILE_SIZE_ERROR':
      return 'validation';
    default:
      return 'transfer';
  }
}
