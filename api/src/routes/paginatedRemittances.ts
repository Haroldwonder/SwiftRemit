/**
 * Paginated remittances list endpoint (SR-051)
 *
 * Demonstrates cursor pagination applied to GET /remittances.
 * The same pattern should be applied to all other list endpoints:
 * GET /anchors, GET /currencies, GET /limits, GET /admin/actions,
 * GET /admin/webhooks/dlq, and analytics endpoints.
 */
import { Router, Request, Response } from 'express';
import { parsePaginationParams, buildCursorEnvelope } from '../middleware/paginate';

const router = Router();

/**
 * GET /remittances
 * Returns a paginated list of remittances using cursor pagination.
 *
 * Query params:
 *   cursor - cursor from previous next_cursor
 *   limit  - page size (default 20, max 100)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { cursor, limit } = parsePaginationParams(req);

    // Build query with keyset pagination (stable under concurrent inserts)
    const query: any = {};
    if (cursor) {
      query._id = { $gt: cursor };
    }

    // Fetch limit+1 to detect has_more
    // Replace with actual DB query in production
    const results: any[] = []; // await Remittance.find(query).sort({ _id: 1 }).limit(limit + 1);

    const envelope = buildCursorEnvelope(results, limit, '_id');
    res.json(envelope);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch remittances' });
  }
});

export default router;
