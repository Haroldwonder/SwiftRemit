/**
 * GraphQL security rules (SR-050).
 *
 * These run as **validation** rules, which is the important part: validation
 * happens after parsing and before execution, so a query that busts a budget is
 * rejected without a single resolver — or database query — running. A limit
 * enforced inside resolvers would already have paid the cost it exists to avoid.
 *
 * Three rules are provided:
 *
 *  - `createDepthLimitRule` — bounds nesting. Without it, a recursive selection
 *    is a trivial denial-of-service: each level multiplies the work.
 *  - `createComplexityRule` — bounds total cost, accounting for list
 *    multipliers. Depth alone is not enough: a shallow query requesting a
 *    thousand items across several list fields is cheap by depth and expensive
 *    to serve.
 *  - `noIntrospectionRule` — hides the schema in production, where the full
 *    internal data model is a reconnaissance gift.
 */

import {
  ASTNode,
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  GraphQLError,
  InlineFragmentNode,
  OperationDefinitionNode,
  SelectionSetNode,
  ValidationContext,
} from 'graphql';
import type { ValidationRule } from 'graphql/validation/ValidationContext';

/** Defaults, overridable per deployment via env. */
export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_MAX_COMPLEXITY = 1000;
/** Assumed page size when a list field does not specify one. */
export const DEFAULT_LIST_SIZE = 20;

export function configuredMaxDepth(): number {
  const raw = Number(process.env.GRAPHQL_MAX_DEPTH);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DEPTH;
}

export function configuredMaxComplexity(): number {
  const raw = Number(process.env.GRAPHQL_MAX_COMPLEXITY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_COMPLEXITY;
}

/** Introspection is disabled in production only. */
export function introspectionDisabled(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isIntrospectionField(name: string): boolean {
  return name === '__schema' || name === '__type';
}

/**
 * Rejects a query whose selection nesting exceeds `maxDepth`.
 *
 * Fragments are resolved as they are encountered so a query cannot dodge the
 * limit by hiding depth behind a fragment spread.
 */
export function createDepthLimitRule(maxDepth: number) {
  return (context: ValidationContext) => {
    const fragments = context.getDocument().definitions.reduce<Record<string, FragmentDefinitionNode>>(
      (acc, def) => {
        if (def.kind === 'FragmentDefinition') acc[def.name.value] = def;
        return acc;
      },
      {},
    );

    /** Guards against a fragment cycle sending this into infinite recursion. */
    function depthOf(node: SelectionSetNode, current: number, seen: Set<string>): number {
      let deepest = current;

      for (const selection of node.selections) {
        if (selection.kind === 'Field') {
          const field = selection as FieldNode;
          if (field.selectionSet) {
            deepest = Math.max(deepest, depthOf(field.selectionSet, current + 1, seen));
          } else {
            deepest = Math.max(deepest, current);
          }
        } else if (selection.kind === 'InlineFragment') {
          const inline = selection as InlineFragmentNode;
          deepest = Math.max(deepest, depthOf(inline.selectionSet, current, seen));
        } else if (selection.kind === 'FragmentSpread') {
          const spread = selection as FragmentSpreadNode;
          if (seen.has(spread.name.value)) continue; // cycle — stop descending
          const fragment = fragments[spread.name.value];
          if (fragment) {
            const nextSeen = new Set(seen).add(spread.name.value);
            deepest = Math.max(deepest, depthOf(fragment.selectionSet, current, nextSeen));
          }
        }
      }

      return deepest;
    }

    return {
      OperationDefinition(operation: OperationDefinitionNode) {
        const depth = depthOf(operation.selectionSet, 1, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query exceeds maximum depth of ${maxDepth} (got ${depth})`,
              { nodes: [operation as ASTNode], extensions: { code: 'QUERY_TOO_DEEP', maxDepth, depth } },
            ),
          );
        }
      },
    };
  };
}

/**
 * Rejects a query whose estimated cost exceeds `maxComplexity`.
 *
 * Cost model: each field costs 1, and a field's children are multiplied by the
 * list size it requests (`limit`, else `DEFAULT_LIST_SIZE`). That multiplier is
 * the point — `remittances(limit: 500) { ...20 fields }` is shallow but serves
 * 10,000 values.
 */
export function createComplexityRule(maxComplexity: number) {
  return (context: ValidationContext) => {
    const fragments = context.getDocument().definitions.reduce<Record<string, FragmentDefinitionNode>>(
      (acc, def) => {
        if (def.kind === 'FragmentDefinition') acc[def.name.value] = def;
        return acc;
      },
      {},
    );

    function listMultiplier(field: FieldNode): number {
      const limitArg = field.arguments?.find((a) => a.name.value === 'limit');
      if (limitArg && limitArg.value.kind === 'IntValue') {
        const parsed = parseInt(limitArg.value.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
      // A list field with no explicit limit still returns a page of rows.
      return field.selectionSet ? DEFAULT_LIST_SIZE : 1;
    }

    function costOf(node: SelectionSetNode, seen: Set<string>): number {
      let total = 0;

      for (const selection of node.selections) {
        if (selection.kind === 'Field') {
          const field = selection as FieldNode;
          total += 1;
          if (field.selectionSet) {
            total += listMultiplier(field) * costOf(field.selectionSet, seen);
          }
        } else if (selection.kind === 'InlineFragment') {
          total += costOf((selection as InlineFragmentNode).selectionSet, seen);
        } else if (selection.kind === 'FragmentSpread') {
          const spread = selection as FragmentSpreadNode;
          if (seen.has(spread.name.value)) continue;
          const fragment = fragments[spread.name.value];
          if (fragment) {
            total += costOf(fragment.selectionSet, new Set(seen).add(spread.name.value));
          }
        }
      }

      return total;
    }

    return {
      OperationDefinition(operation: OperationDefinitionNode) {
        const cost = costOf(operation.selectionSet, new Set());
        if (cost > maxComplexity) {
          context.reportError(
            new GraphQLError(
              `Query exceeds maximum complexity of ${maxComplexity} (got ${cost})`,
              {
                nodes: [operation as ASTNode],
                extensions: { code: 'QUERY_TOO_COMPLEX', maxComplexity, complexity: cost },
              },
            ),
          );
        }
      },
    };
  };
}

/** Rejects any introspection selection. Applied only when in production. */
export function noIntrospectionRule(context: ValidationContext) {
  return {
    Field(node: FieldNode) {
      if (isIntrospectionField(node.name.value)) {
        context.reportError(
          new GraphQLError(
            'GraphQL introspection is disabled in production',
            { nodes: [node], extensions: { code: 'INTROSPECTION_DISABLED' } },
          ),
        );
      }
    },
  };
}

/** The rule set for a request, assembled from the current configuration. */
export function securityRules(): ValidationRule[] {
  const rules: ValidationRule[] = [
    createDepthLimitRule(configuredMaxDepth()) as ValidationRule,
    createComplexityRule(configuredMaxComplexity()) as ValidationRule,
  ];
  if (introspectionDisabled()) rules.push(noIntrospectionRule as ValidationRule);
  return rules;
}
