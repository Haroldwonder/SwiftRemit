/**
 * GraphQL endpoint (SR-050).
 *
 * The previous implementation did not execute GraphQL at all. It regex-scraped
 * the query string:
 *
 *     query.match(/remittances[^{]*\{([^}]+)\}/)
 *
 * and hand-assembled a response, while `graphql/schema.ts` and
 * `graphql/resolvers.ts` were never wired to anything. That is why depth and
 * complexity limits could not simply be "added" — there was no execution
 * pipeline to attach them to.
 *
 * This route now parses, validates, and executes against the real schema, with:
 *
 *  1. Authentication on the transport — no anonymous queries.
 *  2. Depth and complexity budgets enforced as validation rules, so an abusive
 *     query is rejected before any resolver or database call runs.
 *  3. Introspection disabled in production.
 *  4. Field-level authorisation — an unauthorised field resolves to null with an
 *     error entry, never data.
 *  5. Per-operation rate limiting on top of the HTTP limiter.
 *  6. One database round trip per collection — see the batching note in
 *     `graphql/resolvers.ts`.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import {
  GraphQLError,
  execute,
  parse,
  specifiedRules,
  validate,
  type GraphQLFieldResolver,
} from 'graphql';
import { typeDefs } from '../graphql/schema';
import { RemittanceStore, createResolvers } from '../graphql/resolvers';
import { securityRules } from '../graphql/security';
import { UserRole, extractBearerToken, verifyAccessToken } from '../middleware/auth.js';

export type GraphQLRouterOptions = {
  pool?: Pool;
  remittanceStore?: RemittanceStore;
  /** Operations allowed per window, per identity. */
  operationLimit?: number;
  operationWindowMs?: number;
};

const DEFAULT_OPERATION_LIMIT = 30;
const DEFAULT_OPERATION_WINDOW_MS = 60_000;

/**
 * Fields only certain roles may select.
 *
 * Aggregate fee data reveals platform economics, so it is admin-only. Anything
 * not listed is readable by any authenticated caller.
 */
const RESTRICTED_FIELDS: Record<string, UserRole[]> = {
  'Corridor.total_fees': ['admin'],
  'Corridor.avg_fee': ['admin'],
  'Agent.registered_at': ['admin', 'agent'],
};

export interface GraphQLContext {
  userId: string;
  role: UserRole;
  pool?: Pool;
  remittanceStore?: RemittanceStore;
}

/** Per-identity sliding window for operation rate limiting. */
const operationCounters = new Map<string, number[]>();

function overOperationLimit(identity: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (operationCounters.get(identity) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  operationCounters.set(identity, hits);
  return hits.length > limit;
}

/** Test helper — clears the operation rate-limit state. */
export function resetGraphQLRateLimit(): void {
  operationCounters.clear();
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Default field resolver that enforces field-level authorisation.
 *
 * Throwing here makes GraphQL null the field and append an error, which is
 * exactly the required behaviour: the caller learns the field exists and that
 * they may not read it, and never receives its value.
 */
const authorizingFieldResolver: GraphQLFieldResolver<unknown, GraphQLContext> = (
  source,
  args,
  context,
  info,
) => {
  const qualified = `${info.parentType.name}.${info.fieldName}`;
  const allowed = RESTRICTED_FIELDS[qualified];

  if (allowed && !allowed.includes(context.role)) {
    throw new GraphQLError(`Not authorised to read ${qualified}`, {
      extensions: { code: 'FORBIDDEN_FIELD', field: qualified },
    });
  }

  const record = source as Record<string, unknown> | null | undefined;
  if (record == null) return null;

  const value = record[info.fieldName];
  // Mirror graphql's defaultFieldResolver: a function property is a resolver and
  // must receive (args, context, info). Calling it bare would drop the arguments
  // and silently return undefined for every root field.
  return typeof value === 'function'
    ? (value as (a: unknown, c: unknown, i: unknown) => unknown)(args, context, info)
    : value;
};

export function createGraphQLRouter(options: GraphQLRouterOptions = {}): Router {
  const router = Router();
  const {
    pool,
    remittanceStore,
    operationLimit = DEFAULT_OPERATION_LIMIT,
    operationWindowMs = DEFAULT_OPERATION_WINDOW_MS,
  } = options;

  /**
   * POST /api/graphql
   */
  router.post('/', async (req: Request, res: Response) => {
    // 1 — authenticate the transport.
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required', code: 'UNAUTHORIZED' },
        timestamp: timestamp(),
      });
    }

    const authResult = verifyAccessToken(token);
    if (!authResult.ok) {
      return res.status(authResult.status).json({
        success: false,
        error: { message: authResult.message, code: authResult.code },
        timestamp: timestamp(),
      });
    }
    const { userId, role } = authResult.auth;

    // 2 — per-operation rate limit, above the HTTP limiter.
    if (overOperationLimit(userId, operationLimit, operationWindowMs)) {
      return res.status(429).json({
        success: false,
        error: {
          message: 'Too many GraphQL operations. Slow down.',
          code: 'OPERATION_RATE_LIMITED',
        },
        timestamp: timestamp(),
      });
    }

    const { query, variables, operationName } = (req.body ?? {}) as {
      query?: unknown;
      variables?: Record<string, unknown>;
      operationName?: string;
    };

    if (typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Query is required', code: 'INVALID_QUERY' },
        timestamp: timestamp(),
      });
    }

    // 3 — parse.
    let document;
    try {
      document = parse(query);
    } catch (error) {
      return res.status(400).json({
        success: false,
        errors: [
          {
            message: error instanceof Error ? error.message : 'Could not parse query',
            code: 'INVALID_QUERY',
          },
        ],
        timestamp: timestamp(),
      });
    }

    // 4 — validate, including the depth/complexity/introspection budgets. This
    // runs before execution, so a rejected query costs no database work.
    const validationErrors = validate(typeDefs, document, [...specifiedRules, ...securityRules()]);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors.map((e) => ({
          message: e.message,
          code: (e.extensions?.code as string) ?? 'VALIDATION_ERROR',
        })),
        timestamp: timestamp(),
      });
    }

    // 5 — execute with field-level authorisation.
    try {
      const resolvers = createResolvers(pool as Pool, remittanceStore);

      // `buildSchema` + rootValue calls root fields as (args, context, info),
      // whereas createResolvers uses the (parent, args, context, info) shape.
      // Adapting here keeps the resolver signature stable for its own tests.
      const rootValue = Object.fromEntries(
        Object.entries(resolvers).map(([name, fn]) => [
          name,
          (args: Record<string, unknown>, context: GraphQLContext, info: unknown) =>
            (fn as (p: unknown, a: unknown, c: unknown, i: unknown) => unknown)(
              null,
              args,
              context,
              info,
            ),
        ]),
      );

      const context: GraphQLContext = { userId, role, pool, remittanceStore };

      const result = await execute({
        schema: typeDefs,
        document,
        rootValue,
        contextValue: context,
        variableValues: variables,
        operationName,
        fieldResolver: authorizingFieldResolver,
      });

      // Partial success is normal in GraphQL: an unauthorised field is null with
      // an error alongside the data the caller was entitled to.
      return res.json({
        success: !result.errors || result.errors.length === 0,
        data: result.data ?? null,
        ...(result.errors && result.errors.length > 0
          ? {
              errors: result.errors.map((e) => ({
                message: e.message,
                path: e.path,
                code: (e.extensions?.code as string) ?? 'EXECUTION_ERROR',
              })),
            }
          : {}),
        timestamp: timestamp(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          code: 'GRAPHQL_ERROR',
        },
        timestamp: timestamp(),
      });
    }
  });

  /**
   * GET /api/graphql
   * Endpoint metadata. Returns no data, so it stays public — but it must not
   * describe the schema in production.
   */
  router.get('/', (_req: Request, res: Response) => {
    const production = process.env.NODE_ENV === 'production';
    res.json({
      success: true,
      message: 'GraphQL API endpoint',
      usage: 'POST to this endpoint with { query: "query { remittances { id sender amount } }" }',
      authentication: 'Bearer access token required',
      introspection: production ? 'disabled' : 'enabled',
      ...(production ? {} : { supportedQueries: ['remittances', 'corridors', 'agents'] }),
      timestamp: timestamp(),
    });
  });

  return router;
}

export default createGraphQLRouter;
