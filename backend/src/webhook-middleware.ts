import { Request, Response, NextFunction } from 'express';
import { WebhookVerifier } from './webhook-verifier';

/**
 * Extended Express Request with raw body for signature verification
 */
export interface WebhookRequest extends Request {
  rawBody?: string;
  anchorId?: string;
}

/**
 * Options for webhook verification middleware
 */
export interface WebhookVerificationOptions {
  /**
   * Time window for timestamp validation in seconds (default: 300 = 5 minutes)
   */
  timestampWindowSeconds?: number;
  
  /**
   * Whether to require signature (default: true)
   */
  requireSignature?: boolean;
  
  /**
   * Custom function to get anchor secret/public key
   */
  getAnchorSecret?: (anchorId: string) => Promise<string | null>;
}

/**
 * Create webhook verification middleware
 * 
 * This middleware verifies HMAC signatures on all incoming webhook requests.
 * It must be applied AFTER express.json() middleware to access raw body.
 * 
 * @param options - Configuration options
 * @returns Express middleware function
 */
export function createWebhookVerificationMiddleware(
  options: WebhookVerificationOptions = {}
) {
  const {
    timestampWindowSeconds = 300,
    requireSignature = true,
    getAnchorSecret,
  } = options;

  const verifier = new WebhookVerifier(timestampWindowSeconds);

  /**
   * Express middleware for webhook signature verification
   */
  return async (
    req: WebhookRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Extract headers
      const signature = req.headers['x-signature'] as string;
      const timestamp = req.headers['x-timestamp'] as string;
      const nonce = req.headers['x-nonce'] as string;
      const anchorId = req.headers['x-anchor-id'] as string;

      // Check required headers
      if (!anchorId) {
        res.status(401).json({
          error: 'Missing required header: x-anchor-id',
          code: 'MISSING_ANCHOR_ID',
        });
        return;
      }

      // Store anchor ID for handlers
      req.anchorId = anchorId;

      // Check for signature if required
      if (requireSignature && !signature) {
        res.status(401).json({
          error: 'Missing required header: x-signature',
          code: 'MISSING_SIGNATURE',
        });
        return;
      }

      // Get anchor's secret
      let anchorSecret: string | null = null;
      
      if (getAnchorSecret) {
        anchorSecret = await getAnchorSecret(anchorId);
      } else {
        // Fallback: try to get from environment variable
        anchorSecret = process.env[`WEBHOOK_SECRET_${anchorId.toUpperCase()}`] || null;
      }

      if (!anchorSecret) {
        console.warn(`No secret configured for anchor: ${anchorId}`);
        res.status(500).json({
          error: 'Anchor not configured for webhook verification',
          code: 'ANCHOR_NOT_CONFIGURED',
        });
        return;
      }

      // Validate timestamp if provided
      if (timestamp) {
        if (!verifier.validateTimestamp(timestamp)) {
          res.status(401).json({
            error: 'Timestamp outside valid window',
            code: 'INVALID_TIMESTAMP',
          });
          return;
        }
      }

      // Validate nonce if provided
      if (nonce) {
        if (!verifier.validateNonce(nonce)) {
          res.status(401).json({
            error: 'Duplicate nonce detected (replay attack)',
            code: 'INVALID_NONCE',
          });
          return;
        }
      }

      // Verify signature if provided
      if (signature) {
        // Get raw body for verification
        const rawBody = req.rawBody || JSON.stringify(req.body);
        
        if (!verifier.verifyHMAC(rawBody, signature, anchorSecret)) {
          res.status(401).json({
            error: 'Invalid signature',
            code: 'INVALID_SIGNATURE',
          });
          return;
        }
      }

      // All checks passed
      next();
    } catch (error) {
      console.error('Webhook verification error:', error);
      res.status(500).json({
        error: 'Webhook verification failed',
        code: 'VERIFICATION_ERROR',
      });
    }
  };
}

/**
 * Middleware to capture raw body for signature verification
 * 
 * Must be applied BEFORE body-parsing middleware
 */
export function captureRawBody() {
  return (
    req: WebhookRequest,
    res: Response,
    next: NextFunction
  ): void => {
    // Store raw body as chunks
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks).toString('utf8');
      next();
    });
    
    req.on('error', () => {
      next();
    });
  };
}

/**
 * Create webhook routes with verification middleware
 * 
 * Helper to apply verification to all webhook routes
 * 
 * @param app - Express application
 * @param webhookRouter - Router with webhook handlers
 * @param options - Verification options
 */
export function applyWebhookSecurity(
  app: any,
  webhookRouter: any,
  options: WebhookVerificationOptions = {}
): void {
  // Apply verification middleware to all webhook routes
  const verificationMiddleware = createWebhookVerificationMiddleware(options);
  
  // Apply to the webhook router
  app.use('/webhooks', verificationMiddleware);
  app.use('/webhooks', (req: WebhookRequest, res: Response, next: NextFunction) => {
    // Allow health check without verification
    if (req.path === '/health') {
      next();
    } else {
      verificationMiddleware(req, res, next);
    }
  });
}