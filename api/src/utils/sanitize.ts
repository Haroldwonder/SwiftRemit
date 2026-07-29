/**
 * api/src/utils/sanitize.ts
 *
 * Thin re-export shim — all logic lives in the shared package.
 * Import from here as before; nothing in the API service changes.
 */
export {
  sanitizeInput,
  sanitizeForJson,
  sanitizeForHtmlEmail,
  sanitizeForPdf,
  sanitizeOnChainMemo,
  sanitizeObject,
  containsXss,
} from '../../../shared/src/sanitizer';
