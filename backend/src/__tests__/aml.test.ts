/**
 * SR-112 — AML/CTF control tests.
 *
 * Every control asserted in docs/AML_CTF_COMPLIANCE.md has a test here:
 *   - sanctions/PEP screening: matching, decisioning, alerting, rescreen cadence
 *   - transaction monitoring: structuring, velocity, corridor, round-amount
 *   - alert queue: dedupe, transition enforcement, mandatory narratives
 *   - SAR workflow: escalation gate, lifecycle, retention stamping
 *   - travel rule: threshold resolution, data-set validation, transmission
 *   - retention: cutoff arithmetic, guards, run logging
 *
 * The database is replaced by an in-memory stub so the suite runs in
 * milliseconds without Postgres.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  DEFAULT_SCREENING_CONFIG,
  SanctionsScreeningService,
  decideOutcome,
  editDistance,
  nameSimilarity,
  normalizeName,
  scoreEntry,
} from '../aml/sanctions-screening';
import {
  evaluateRules,
  roundAmountRepetitionRule,
  structuringRule,
  unusualCorridorRule,
  velocityAmountRule,
  velocityCountRule,
  widestLookbackHours,
  windowBucket,
  type RuleDefinition,
  type TransferRecord,
} from '../aml/transaction-monitoring';
import {
  AlertDispositionError,
  buildAlertQuery,
  disposeAlert,
  raiseAlert,
} from '../aml/alerts';
import {
  MIN_NARRATIVE_LENGTH,
  SarWorkflowError,
  SarWorkflowService,
  formatSarReference,
  isSarTransitionAllowed,
} from '../aml/sar-workflow';
import {
  TravelRuleError,
  TravelRuleService,
  payloadHash,
  validateDataSets,
} from '../aml/travel-rule';
import { ENTITY_PLANS, RetentionService, type RetentionPolicy } from '../aml/retention';
import { isAlertTransitionAllowed } from '../aml/types';

// ---------------------------------------------------------------------------
// Query stub: matches on a SQL fragment and returns canned rows.
// ---------------------------------------------------------------------------

interface Stubbed {
  match: string;
  rows?: any[];
  rowCount?: number;
  throws?: Error;
}

class FakeDb {
  readonly calls: Array<{ text: string; params: unknown[] }> = [];
  private stubs: Stubbed[] = [];

  on(match: string, rows: any[] = [], rowCount?: number): this {
    this.stubs.push({ match, rows, rowCount });
    return this;
  }

  onThrow(match: string, error: Error): this {
    this.stubs.push({ match, throws: error });
    return this;
  }

  async query<R = any>(text: string, params: unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
    this.calls.push({ text, params });
    const normalized = text.replace(/\s+/g, ' ');
    const stub = this.stubs.find((s) => normalized.includes(s.match));
    if (stub?.throws) throw stub.throws;
    const rows = (stub?.rows ?? []) as R[];
    return { rows, rowCount: stub?.rowCount ?? rows.length };
  }

  /** Queries whose text contains `fragment`. */
  find(fragment: string): Array<{ text: string; params: unknown[] }> {
    return this.calls.filter((c) => c.text.replace(/\s+/g, ' ').includes(fragment));
  }
}

const AT = new Date('2026-06-01T12:00:00Z');
const fixedNow = () => AT;

function transfer(overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    transactionId: 'tx-1',
    senderAddress: 'GSENDER',
    amount: 100,
    currency: 'USDC',
    corridor: 'USD/PHP',
    createdAt: AT,
    ...overrides,
  };
}

function rule(code: string, params: Record<string, any>, severity: any = 'medium'): RuleDefinition {
  return { code, name: code, severity, enabled: true, params };
}

// ===========================================================================
// Sanctions / PEP screening
// ===========================================================================

describe('SR-112 sanctions screening — name handling', () => {
  it('normalises case, diacritics, punctuation and honorifics', () => {
    expect(normalizeName('  Mr. José  Álvarez-Gómez ')).toBe('JOSE ALVAREZ GOMEZ');
    expect(normalizeName('SMITH, John Q.')).toBe('SMITH JOHN Q');
    expect(normalizeName('Dr Jane Doe Jr')).toBe('JANE DOE');
  });

  it('returns an empty string when a name is only noise', () => {
    expect(normalizeName('!!! ???')).toBe('');
    expect(normalizeName('Mr.')).toBe('');
  });

  it('computes edit distance symmetrically', () => {
    expect(editDistance('MOHAMMED', 'MUHAMMAD')).toBe(2);
    expect(editDistance('MUHAMMAD', 'MOHAMMED')).toBe(2);
    expect(editDistance('', 'ABC')).toBe(3);
    expect(editDistance('SAME', 'SAME')).toBe(0);
  });

  it('scores transliteration variants highly and unrelated names low', () => {
    expect(nameSimilarity('MOHAMMED ALI', 'MUHAMMAD ALI')).toBeGreaterThan(0.8);
    expect(nameSimilarity('JOHN SMITH', 'MARIA GARCIA')).toBeLessThan(0.5);
  });

  it('matches reordered names via the token-set signal', () => {
    expect(nameSimilarity('SMITH JOHN', 'JOHN QUINCY SMITH')).toBeGreaterThanOrEqual(
      DEFAULT_SCREENING_CONFIG.reviewScore,
    );
  });

  it('does not give full credit for a single shared common token', () => {
    // "JOHN" alone must not push an unrelated person over the review threshold.
    expect(nameSimilarity('JOHN ABERNATHY', 'JOHN KOWALCZYK')).toBeLessThan(
      DEFAULT_SCREENING_CONFIG.reviewScore,
    );
  });
});

describe('SR-112 sanctions screening — entry scoring', () => {
  const entry = {
    id: 7,
    list_source: 'OFAC_SDN',
    entry_type: 'sanctions' as const,
    full_name: 'Ivan Petrov',
    normalized_name: 'IVAN PETROV',
    aliases: ['Iwan Petroff'],
    country: 'RU',
    date_of_birth: '1970-01-01',
    program: 'UKRAINE-EO13662',
  };

  it('returns null below the review threshold', () => {
    expect(scoreEntry({ subjectType: 'sender', subjectId: 'G1', name: 'Alice Nguyen' }, entry)).toBeNull();
  });

  it('reports an exact hit at score 1', () => {
    const match = scoreEntry({ subjectType: 'sender', subjectId: 'G1', name: 'Ivan Petrov' }, entry);
    expect(match).not.toBeNull();
    expect(match!.score).toBe(1);
    expect(match!.matchedOn).toBe('name');
    expect(match!.entryId).toBe(7);
  });

  it('matches on an alias and reports which alias hit', () => {
    const match = scoreEntry({ subjectType: 'sender', subjectId: 'G1', name: 'Iwan Petroff' }, entry);
    expect(match).not.toBeNull();
    expect(match!.matchedOn).toBe('alias');
    expect(match!.matchedName).toBe('Iwan Petroff');
  });

  it('discounts the score on a date-of-birth mismatch', () => {
    const matching = scoreEntry(
      { subjectType: 'sender', subjectId: 'G1', name: 'Ivan Petrov', dateOfBirth: '1970-01-01' },
      entry,
    );
    const mismatching = scoreEntry(
      { subjectType: 'sender', subjectId: 'G1', name: 'Ivan Petrov', dateOfBirth: '1988-12-12' },
      entry,
    );
    expect(matching!.score).toBe(1);
    expect(mismatching!.score).toBeLessThan(1);
  });

  it('ignores an unparseable aliases payload rather than throwing', () => {
    const match = scoreEntry(
      { subjectType: 'sender', subjectId: 'G1', name: 'Ivan Petrov' },
      { ...entry, aliases: 'not-json' },
    );
    expect(match!.score).toBe(1);
  });
});

describe('SR-112 sanctions screening — decisioning', () => {
  const base = {
    entryId: 1,
    listSource: 'OFAC_SDN',
    matchedName: 'X',
    matchedOn: 'name' as const,
    country: null,
    program: null,
  };

  it('is clear with no matches', () => {
    expect(decideOutcome([])).toEqual({ outcome: 'clear', decision: 'allow', highestScore: 0 });
  });

  it('blocks on a near-exact sanctions hit', () => {
    const result = decideOutcome([{ ...base, entryType: 'sanctions', score: 0.99 }]);
    expect(result.outcome).toBe('potential_match');
    expect(result.decision).toBe('block');
  });

  it('never auto-blocks on a PEP hit — PEP status means EDD, not prohibition', () => {
    const result = decideOutcome([{ ...base, entryType: 'pep', score: 1 }]);
    expect(result.decision).toBe('review');
  });

  it('routes a fuzzy sanctions hit to review rather than blocking', () => {
    const result = decideOutcome([{ ...base, entryType: 'sanctions', score: 0.9 }]);
    expect(result.decision).toBe('review');
    expect(result.highestScore).toBe(0.9);
  });
});

describe('SR-112 sanctions screening — service', () => {
  it('persists a clear run, sets the next screening date, and raises no alert', async () => {
    const db = new FakeDb()
      .on('FROM sanctions_list_entries', [
        {
          id: 1,
          list_source: 'OFAC_SDN',
          entry_type: 'sanctions',
          full_name: 'Ivan Petrov',
          normalized_name: 'IVAN PETROV',
          aliases: [],
          country: 'RU',
          date_of_birth: null,
          program: null,
        },
      ])
      .on('INSERT INTO sanctions_screening_results', [{ id: 42 }]);

    const service = new SanctionsScreeningService(db, DEFAULT_SCREENING_CONFIG, fixedNow);
    const result = await service.screen({
      subjectType: 'sender',
      subjectId: 'GSENDER',
      name: 'Alice Nguyen',
    });

    expect(result.outcome).toBe('clear');
    expect(result.decision).toBe('allow');
    expect(result.screeningId).toBe(42);
    expect(result.listsScreened).toEqual(['OFAC_SDN']);
    // 90-day default cadence.
    expect(result.nextScreeningAt.getTime() - AT.getTime()).toBe(90 * 86_400_000);
    expect(db.find('INSERT INTO aml_alerts')).toHaveLength(0);
  });

  it('raises a critical alert and returns block on a confirmed-strength hit', async () => {
    const db = new FakeDb()
      .on('FROM sanctions_list_entries', [
        {
          id: 1,
          list_source: 'OFAC_SDN',
          entry_type: 'sanctions',
          full_name: 'Ivan Petrov',
          normalized_name: 'IVAN PETROV',
          aliases: [],
          country: 'RU',
          date_of_birth: null,
          program: 'UKRAINE-EO13662',
        },
      ])
      .on('INSERT INTO sanctions_screening_results', [{ id: 43 }])
      .on('INSERT INTO aml_alerts', [{ id: 99 }]);

    const service = new SanctionsScreeningService(db, DEFAULT_SCREENING_CONFIG, fixedNow);
    const result = await service.screen(
      { subjectType: 'agent', subjectId: 'agent-1', name: 'Ivan Petrov' },
      'onboarding',
    );

    expect(result.decision).toBe('block');
    expect(result.alertId).toBe(99);

    const [alertInsert] = db.find('INSERT INTO aml_alerts');
    expect(alertInsert.params[0]).toBe('SANCTIONS_HIT');
    expect(alertInsert.params[1]).toBe('critical');
    expect(alertInsert.params[2]).toBe('agent');
    expect(alertInsert.params[3]).toBe('agent-1');
  });

  it('screens every due subject in the periodic cycle and survives a single failure', async () => {
    const db = new FakeDb()
      .on('DISTINCT ON (subject_type, subject_id)', [
        { subject_type: 'sender', subject_id: 'G1', subject_name: 'Ivan Petrov', subject_country: 'RU' },
        { subject_type: 'sender', subject_id: 'G2', subject_name: 'Alice Nguyen', subject_country: 'PH' },
      ])
      .on('FROM sanctions_list_entries', [
        {
          id: 1,
          list_source: 'OFAC_SDN',
          entry_type: 'sanctions',
          full_name: 'Ivan Petrov',
          normalized_name: 'IVAN PETROV',
          aliases: [],
          country: 'RU',
          date_of_birth: null,
          program: null,
        },
      ])
      .on('INSERT INTO sanctions_screening_results', [{ id: 1 }])
      .on('INSERT INTO aml_alerts', [{ id: 1 }]);

    const service = new SanctionsScreeningService(db, DEFAULT_SCREENING_CONFIG, fixedNow);
    const summary = await service.runPeriodicRescreening();

    expect(summary.screened).toBe(2);
    expect(summary.hits).toBe(1);
    expect(summary.errors).toBe(0);
    // Trigger recorded as 'periodic', which is what evidences ongoing screening.
    expect(db.find('INSERT INTO sanctions_screening_results')[0].params[4]).toBe('periodic');
  });

  it('counts a failing subject as an error without aborting the batch', async () => {
    const db = new FakeDb()
      .on('DISTINCT ON (subject_type, subject_id)', [
        { subject_type: 'sender', subject_id: 'G1', subject_name: 'A B', subject_country: null },
      ])
      .onThrow('FROM sanctions_list_entries', new Error('list table offline'));

    const service = new SanctionsScreeningService(db, DEFAULT_SCREENING_CONFIG, fixedNow);
    const summary = await service.runPeriodicRescreening();

    expect(summary).toEqual({ screened: 0, hits: 0, errors: 1 });
  });
});

// ===========================================================================
// Transaction monitoring
// ===========================================================================

describe('SR-112 monitoring — structuring', () => {
  const structuring = rule('STRUCTURING', {
    lookback_hours: 168,
    min_count: 3,
    threshold_ratio: 0.9,
    aggregate_multiplier: 1.0,
  }, 'high');

  it('fires when sub-threshold transfers aggregate past the threshold', () => {
    const history = [
      transfer({ transactionId: 'tx-2', amount: 4000, createdAt: new Date(AT.getTime() - 3_600_000) }),
      transfer({ transactionId: 'tx-3', amount: 4000, createdAt: new Date(AT.getTime() - 7_200_000) }),
    ];
    const hit = structuringRule(
      {
        transfer: transfer({ amount: 4000 }),
        history,
        knownCorridors: new Set(['USD/PHP']),
        reportingThreshold: 10_000,
      },
      structuring,
    );

    expect(hit).not.toBeNull();
    expect(hit!.details.transfer_count).toBe(3);
    expect(hit!.details.aggregate_amount).toBe(12_000);
  });

  it('abstains when no reporting threshold is configured', () => {
    const hit = structuringRule(
      {
        transfer: transfer({ amount: 4000 }),
        history: [transfer({ transactionId: 'tx-2', amount: 4000 }), transfer({ transactionId: 'tx-3', amount: 4000 })],
        knownCorridors: new Set(),
        reportingThreshold: null,
      },
      structuring,
    );
    expect(hit).toBeNull();
  });

  it('does not fire on ordinary high-volume activity above the threshold', () => {
    // A transfer that clears the threshold on its own is reported, not structured.
    const hit = structuringRule(
      {
        transfer: transfer({ amount: 15_000 }),
        history: [
          transfer({ transactionId: 'tx-2', amount: 4000 }),
          transfer({ transactionId: 'tx-3', amount: 4000 }),
        ],
        knownCorridors: new Set(),
        reportingThreshold: 10_000,
      },
      structuring,
    );
    expect(hit).toBeNull();
  });

  it('ignores transfers that fell outside the lookback window', () => {
    const stale = new Date(AT.getTime() - 200 * 3_600_000);
    const hit = structuringRule(
      {
        transfer: transfer({ amount: 4000 }),
        history: [
          transfer({ transactionId: 'tx-2', amount: 4000, createdAt: stale }),
          transfer({ transactionId: 'tx-3', amount: 4000, createdAt: stale }),
        ],
        knownCorridors: new Set(),
        reportingThreshold: 10_000,
      },
      structuring,
    );
    expect(hit).toBeNull();
  });
});

describe('SR-112 monitoring — velocity', () => {
  it('fires on transfer count over the limit', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      transfer({ transactionId: `tx-h${i}`, createdAt: new Date(AT.getTime() - (i + 1) * 60_000) }),
    );
    const hit = velocityCountRule(
      { transfer: transfer(), history, knownCorridors: new Set(), reportingThreshold: null },
      rule('VELOCITY_COUNT', { lookback_hours: 24, max_count: 10 }),
    );
    expect(hit).not.toBeNull();
    expect(hit!.details.observed_count).toBe(11);
  });

  it('does not fire exactly at the limit', () => {
    const history = Array.from({ length: 9 }, (_, i) =>
      transfer({ transactionId: `tx-h${i}`, createdAt: new Date(AT.getTime() - (i + 1) * 60_000) }),
    );
    const hit = velocityCountRule(
      { transfer: transfer(), history, knownCorridors: new Set(), reportingThreshold: null },
      rule('VELOCITY_COUNT', { lookback_hours: 24, max_count: 10 }),
    );
    expect(hit).toBeNull();
  });

  it('fires on aggregate value over the limit', () => {
    const hit = velocityAmountRule(
      {
        transfer: transfer({ amount: 6000 }),
        history: [transfer({ transactionId: 'tx-2', amount: 5000 })],
        knownCorridors: new Set(),
        reportingThreshold: null,
      },
      rule('VELOCITY_AMOUNT', { lookback_hours: 24, max_amount: 10_000 }, 'high'),
    );
    expect(hit).not.toBeNull();
    expect(hit!.details.observed_amount).toBe(11_000);
  });
});

describe('SR-112 monitoring — corridors', () => {
  const corridorRule = rule('UNUSUAL_CORRIDOR', {
    lookback_days: 180,
    high_risk_corridors: ['USD/IRR'],
  });

  it('escalates a high-risk corridor to high severity', () => {
    const hit = unusualCorridorRule(
      {
        transfer: transfer({ corridor: 'USD/IRR' }),
        history: [],
        knownCorridors: new Set(['USD/IRR']),
        reportingThreshold: null,
      },
      corridorRule,
    );
    expect(hit).not.toBeNull();
    expect(hit!.severity).toBe('high');
    expect(hit!.details.reason).toBe('high_risk_corridor');
  });

  it('flags a corridor the sender has never used', () => {
    const hit = unusualCorridorRule(
      {
        transfer: transfer({ corridor: 'USD/NGN' }),
        history: [],
        knownCorridors: new Set(['USD/PHP']),
        reportingThreshold: null,
      },
      corridorRule,
    );
    expect(hit!.details.reason).toBe('first_use_by_sender');
  });

  it('does not flag a first-ever transfer — no baseline exists yet', () => {
    const hit = unusualCorridorRule(
      {
        transfer: transfer({ corridor: 'USD/NGN' }),
        history: [],
        knownCorridors: new Set(),
        reportingThreshold: null,
      },
      corridorRule,
    );
    expect(hit).toBeNull();
  });

  it('does not flag a corridor the sender already uses', () => {
    const hit = unusualCorridorRule(
      {
        transfer: transfer({ corridor: 'USD/PHP' }),
        history: [],
        knownCorridors: new Set(['USD/PHP', 'USD/MXN']),
        reportingThreshold: null,
      },
      corridorRule,
    );
    expect(hit).toBeNull();
  });
});

describe('SR-112 monitoring — round-amount repetition', () => {
  const roundRule = rule('ROUND_AMOUNT_REPETITION', {
    lookback_hours: 72,
    min_count: 3,
    round_to: 1000,
  }, 'low');

  it('fires on repeated identical round figures', () => {
    const hit = roundAmountRepetitionRule(
      {
        transfer: transfer({ amount: 5000 }),
        history: [
          transfer({ transactionId: 'tx-2', amount: 5000 }),
          transfer({ transactionId: 'tx-3', amount: 5000 }),
        ],
        knownCorridors: new Set(),
        reportingThreshold: null,
      },
      roundRule,
    );
    expect(hit).not.toBeNull();
    expect(hit!.details.occurrences).toBe(3);
  });

  it('ignores non-round amounts', () => {
    const hit = roundAmountRepetitionRule(
      {
        transfer: transfer({ amount: 5123.45 }),
        history: [transfer({ transactionId: 'tx-2', amount: 5123.45 }), transfer({ transactionId: 'tx-3', amount: 5123.45 })],
        knownCorridors: new Set(),
        reportingThreshold: null,
      },
      roundRule,
    );
    expect(hit).toBeNull();
  });
});

describe('SR-112 monitoring — orchestration', () => {
  it('skips disabled rules and reports rules with no implementation', () => {
    const rules: RuleDefinition[] = [
      { ...rule('VELOCITY_COUNT', { lookback_hours: 24, max_count: 0 }), enabled: false },
      rule('NOT_IMPLEMENTED_YET', {}),
    ];
    const { hits, unimplemented } = evaluateRules(
      { transfer: transfer(), history: [], knownCorridors: new Set(), reportingThreshold: null },
      rules,
    );
    expect(hits).toHaveLength(0);
    expect(unimplemented).toEqual(['NOT_IMPLEMENTED_YET']);
  });

  it('derives the widest lookback across hour- and day-based rules', () => {
    expect(
      widestLookbackHours([
        rule('A', { lookback_hours: 48 }),
        rule('B', { lookback_days: 180 }),
      ]),
    ).toBe(180 * 24);
  });

  it('buckets a window so repeated evaluation reuses one dedupe key', () => {
    const a = windowBucket(new Date('2026-06-01T00:10:00Z'), 24);
    const b = windowBucket(new Date('2026-06-01T23:50:00Z'), 24);
    const c = windowBucket(new Date('2026-06-03T00:10:00Z'), 24);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

// ===========================================================================
// Alert queue
// ===========================================================================

describe('SR-112 alert queue', () => {
  it('returns the existing alert id when the dedupe key was already seen', async () => {
    const db = new FakeDb()
      .on('INSERT INTO aml_alerts', [])
      .on('SELECT id FROM aml_alerts WHERE dedupe_key', [{ id: 17 }]);

    const id = await raiseAlert(db, {
      ruleCode: 'VELOCITY_COUNT',
      severity: 'medium',
      subjectType: 'sender',
      subjectId: 'G1',
      dedupeKey: 'VELOCITY_COUNT:G1:1',
    });

    expect(id).toBe(17);
  });

  it('builds a parameterised WHERE clause with no interpolated values', () => {
    const { where, params } = buildAlertQuery({ status: 'open', severity: 'high', subjectId: 'G1' });
    expect(where).toBe('WHERE status = $1 AND severity = $2 AND subject_id = $3');
    expect(params).toEqual(['open', 'high', 'G1']);
  });

  it('produces no WHERE clause for an empty query', () => {
    expect(buildAlertQuery({})).toEqual({ where: '', params: [] });
  });

  it('enforces the documented transition table', () => {
    expect(isAlertTransitionAllowed('open', 'in_review')).toBe(true);
    expect(isAlertTransitionAllowed('escalated', 'reported')).toBe(true);
    expect(isAlertTransitionAllowed('closed_no_action', 'open')).toBe(false);
    expect(isAlertTransitionAllowed('reported', 'in_review')).toBe(false);
    expect(isAlertTransitionAllowed('open', 'reported')).toBe(false);
  });

  it('rejects a transition the table disallows', async () => {
    const db = new FakeDb().on('SELECT * FROM aml_alerts WHERE id', [{ id: 1, status: 'closed_no_action' }]);
    await expect(
      disposeAlert(db, 1, { status: 'in_review', actor: 'officer-1' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('requires a narrative to close a true-positive alert', async () => {
    const db = new FakeDb().on('SELECT * FROM aml_alerts WHERE id', [{ id: 1, status: 'open' }]);
    await expect(
      disposeAlert(db, 1, {
        status: 'closed_no_action',
        disposition: 'true_positive',
        actor: 'officer-1',
      }),
    ).rejects.toBeInstanceOf(AlertDispositionError);
  });

  it('accepts a false-positive close without a narrative and stamps closed_at', async () => {
    const db = new FakeDb()
      .on('SELECT * FROM aml_alerts WHERE id', [{ id: 1, status: 'open' }])
      .on('UPDATE aml_alerts', [{ id: 1, status: 'closed_no_action' }]);

    const updated = await disposeAlert(db, 1, {
      status: 'closed_no_action',
      disposition: 'false_positive',
      actor: 'officer-1',
    });

    expect(updated.status).toBe('closed_no_action');
    const [update] = db.find('UPDATE aml_alerts');
    // 6th parameter is the terminal flag driving closed_at.
    expect(update.params[5]).toBe(true);
    expect(update.params[3]).toBe('officer-1');
  });

  it('404s on an unknown alert', async () => {
    const db = new FakeDb().on('SELECT * FROM aml_alerts WHERE id', []);
    await expect(disposeAlert(db, 404, { status: 'in_review', actor: 'o' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

// ===========================================================================
// SAR workflow
// ===========================================================================

describe('SR-112 SAR workflow', () => {
  const narrative = 'x'.repeat(MIN_NARRATIVE_LENGTH);

  it('formats sequential references within the calendar year', () => {
    expect(formatSarReference(2026, 7)).toBe('SAR-2026-0007');
    expect(formatSarReference(2026, 1234)).toBe('SAR-2026-1234');
  });

  it('enforces the documented lifecycle', () => {
    expect(isSarTransitionAllowed('draft', 'under_review')).toBe(true);
    expect(isSarTransitionAllowed('under_review', 'filed')).toBe(true);
    expect(isSarTransitionAllowed('filed', 'acknowledged')).toBe(true);
    expect(isSarTransitionAllowed('draft', 'filed')).toBe(false);
    expect(isSarTransitionAllowed('acknowledged', 'draft')).toBe(false);
  });

  it('refuses a narrative shorter than the FIU minimum', async () => {
    const service = new SarWorkflowService(new FakeDb(), fixedNow);
    await expect(
      service.createFromAlerts({
        jurisdiction: 'US',
        subjectId: 'G1',
        alertIds: [1],
        narrative: 'too short',
        preparedBy: 'officer-1',
      }),
    ).rejects.toMatchObject({ code: 'narrative_too_short' });
  });

  it('refuses to draft from alerts that have not been escalated', async () => {
    const db = new FakeDb().on('FROM aml_alerts WHERE id = ANY', [
      { id: 1, status: 'open', transaction_id: 'tx-1', details: {} },
    ]);
    const service = new SarWorkflowService(db, fixedNow);
    await expect(
      service.createFromAlerts({
        jurisdiction: 'US',
        subjectId: 'G1',
        alertIds: [1],
        narrative,
        preparedBy: 'officer-1',
      }),
    ).rejects.toMatchObject({ code: 'alert_not_escalated' });
  });

  it('drafts from escalated alerts, allocates a reference and logs the event', async () => {
    const db = new FakeDb()
      .on('FROM aml_alerts WHERE id = ANY', [
        { id: 1, status: 'escalated', transaction_id: 'tx-1', details: {} },
        { id: 2, status: 'escalated', transaction_id: 'tx-2', details: {} },
      ])
      .on('COALESCE(SUM(amount_in), 0)', [{ total: '9000' }])
      .on('COUNT(*)::text AS count FROM sar_reports', [{ count: '3' }])
      .on('INSERT INTO sar_reports', [{ id: 5, reference: 'SAR-2026-0004', status: 'draft', alert_ids: [1, 2] }]);

    const service = new SarWorkflowService(db, fixedNow);
    const sar = await service.createFromAlerts({
      jurisdiction: 'us',
      subjectId: 'G1',
      alertIds: [1, 2],
      narrative,
      preparedBy: 'officer-1',
    });

    expect(sar.reference).toBe('SAR-2026-0004');
    const [insert] = db.find('INSERT INTO sar_reports');
    expect(insert.params[0]).toBe('SAR-2026-0004');
    expect(insert.params[1]).toBe('US');
    expect(JSON.parse(insert.params[5] as string)).toEqual(['tx-1', 'tx-2']);
    expect(db.find('INSERT INTO sar_report_events')).toHaveLength(1);
  });

  it('rejects a draft referencing a non-existent alert', async () => {
    const db = new FakeDb().on('FROM aml_alerts WHERE id = ANY', [
      { id: 1, status: 'escalated', transaction_id: null, details: {} },
    ]);
    const service = new SarWorkflowService(db, fixedNow);
    await expect(
      service.createFromAlerts({
        jurisdiction: 'US',
        subjectId: 'G1',
        alertIds: [1, 2],
        narrative,
        preparedBy: 'officer-1',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('stamps the retention deadline from the schedule on filing and reports the alerts', async () => {
    const db = new FakeDb()
      .on('SELECT * FROM sar_reports WHERE id', [
        { id: 5, reference: 'SAR-2026-0004', status: 'under_review', alert_ids: [1, 2] },
      ])
      .on("WHERE entity = 'sar_reports'", [{ retention_days: 1826 }])
      .on('UPDATE sar_reports', [{ id: 5, status: 'filed' }]);

    const service = new SarWorkflowService(db, fixedNow);
    await service.transition(5, 'filed', 'officer-2', { notes: 'filed with FinCEN' });

    const [update] = db.find('UPDATE sar_reports');
    const retentionUntil = update.params[4] as Date;
    expect(retentionUntil.getTime() - AT.getTime()).toBe(1826 * 86_400_000);
    // Source alerts move to 'reported'.
    expect(db.find("SET status = 'reported'")).toHaveLength(1);
  });

  it('will not acknowledge a SAR without an FIU reference', async () => {
    const db = new FakeDb().on('SELECT * FROM sar_reports WHERE id', [
      { id: 5, status: 'filed', alert_ids: [], external_reference: null },
    ]);
    const service = new SarWorkflowService(db, fixedNow);
    await expect(service.transition(5, 'acknowledged', 'officer-2')).rejects.toMatchObject({
      code: 'missing_reference',
    });
  });

  it('rejects an out-of-order transition', async () => {
    const db = new FakeDb().on('SELECT * FROM sar_reports WHERE id', [
      { id: 5, reference: 'SAR-2026-0004', status: 'draft', alert_ids: [] },
    ]);
    const service = new SarWorkflowService(db, fixedNow);
    await expect(service.transition(5, 'filed', 'officer-2')).rejects.toBeInstanceOf(SarWorkflowError);
  });
});

// ===========================================================================
// Travel rule
// ===========================================================================

describe('SR-112 travel rule — thresholds', () => {
  function dbWith(rows: any[]) {
    return new FakeDb().on('FROM travel_rule_thresholds', rows);
  }

  it('uses the jurisdiction row when one exists', async () => {
    const service = new TravelRuleService(
      dbWith([
        { jurisdiction: 'US', threshold_usd: '3000' },
        { jurisdiction: 'DEFAULT', threshold_usd: '1000' },
      ]),
    );
    expect(await service.resolveThreshold('US', 2999)).toMatchObject({
      required: false,
      threshold: 3000,
      source: 'jurisdiction',
    });
    expect(await service.resolveThreshold('US', 3000)).toMatchObject({ required: true });
  });

  it('falls back to DEFAULT for an unlisted jurisdiction', async () => {
    const service = new TravelRuleService(dbWith([{ jurisdiction: 'DEFAULT', threshold_usd: '1000' }]));
    expect(await service.resolveThreshold('ZZ', 1500)).toMatchObject({
      required: true,
      threshold: 1000,
      source: 'default',
    });
  });

  it('treats a zero threshold as always-required (EU has no de minimis)', async () => {
    const service = new TravelRuleService(dbWith([{ jurisdiction: 'EU', threshold_usd: '0' }]));
    expect(await service.resolveThreshold('EU', 1)).toMatchObject({ required: true, threshold: 0 });
  });

  it('fails safe to required when no threshold is configured at all', async () => {
    const service = new TravelRuleService(dbWith([]));
    expect(await service.resolveThreshold('US', 1)).toMatchObject({ required: true, threshold: 0 });
  });
});

describe('SR-112 travel rule — data sets', () => {
  const originator = {
    name: 'Alice Nguyen',
    accountIdentifier: 'GALICE',
    address: '1 Main St, Manila',
  };
  const beneficiary = { name: 'Bob Cruz', accountIdentifier: 'GBOB' };

  it('accepts a complete data set', () => {
    expect(validateDataSets(originator, beneficiary)).toEqual([]);
  });

  it('accepts date+place of birth in place of an address', () => {
    expect(
      validateDataSets(
        { name: 'A', accountIdentifier: 'G1', dateOfBirth: '1990-01-01', placeOfBirth: 'Manila' },
        beneficiary,
      ),
    ).toEqual([]);
  });

  it('rejects an originator with no secondary identifier', () => {
    const missing = validateDataSets({ name: 'A', accountIdentifier: 'G1' }, beneficiary);
    expect(missing).toContain('originator.address|nationalIdentifier|dateOfBirth+placeOfBirth');
  });

  it('reports every missing field at once', () => {
    const missing = validateDataSets(undefined, undefined);
    expect(missing).toEqual(['originator', 'beneficiary']);
  });

  it('hashes payloads stably regardless of key order', () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});

describe('SR-112 travel rule — lifecycle', () => {
  it('refuses to record an above-threshold transfer with incomplete data', async () => {
    const db = new FakeDb().on('FROM travel_rule_thresholds', [{ jurisdiction: 'US', threshold_usd: '3000' }]);
    const service = new TravelRuleService(db);
    await expect(
      service.record({
        transactionId: 'tx-1',
        jurisdiction: 'US',
        amount: 5000,
        currency: 'USDC',
        amountUsd: 5000,
      }),
    ).rejects.toBeInstanceOf(TravelRuleError);
    expect(db.find('INSERT INTO travel_rule_transfers')).toHaveLength(0);
  });

  it('records a below-threshold transfer as not_required so the decision is evidenced', async () => {
    const db = new FakeDb()
      .on('FROM travel_rule_thresholds', [{ jurisdiction: 'US', threshold_usd: '3000' }])
      .on('INSERT INTO travel_rule_transfers', [{ id: 1 }]);
    const service = new TravelRuleService(db);

    const result = await service.record({
      transactionId: 'tx-1',
      jurisdiction: 'US',
      amount: 100,
      currency: 'USDC',
      amountUsd: 100,
    });

    expect(result).toMatchObject({ required: false, transmissionStatus: 'not_required' });
  });

  it('assess() records the obligation and alerts when data is missing', async () => {
    const db = new FakeDb()
      .on('FROM travel_rule_thresholds', [{ jurisdiction: 'US', threshold_usd: '3000' }])
      .on('INSERT INTO travel_rule_transfers', [{ id: 1 }])
      .on('INSERT INTO aml_alerts', [{ id: 88 }]);
    const service = new TravelRuleService(db);

    const result = await service.assess({
      transactionId: 'tx-1',
      jurisdiction: 'US',
      amount: 5000,
      currency: 'USDC',
      amountUsd: 5000,
      originator: { name: 'Alice', accountIdentifier: 'GALICE' },
      beneficiary: { name: 'Bob', accountIdentifier: 'GBOB' },
    });

    expect(result.required).toBe(true);
    expect(result.missing).toHaveLength(1);
    const [alert] = db.find('INSERT INTO aml_alerts');
    expect(alert.params[0]).toBe('TRAVEL_RULE_INCOMPLETE');
  });

  it('marks a record transmitted and stores the payload hash', async () => {
    const db = new FakeDb()
      .on('FROM travel_rule_transfers WHERE transaction_id', [
        {
          transaction_id: 'tx-1',
          originator: { name: 'Alice', accountIdentifier: 'GALICE', address: '1 Main St' },
          beneficiary: { name: 'Bob', accountIdentifier: 'GBOB' },
          amount: '5000',
          currency: 'USDC',
          counterparty_vasp: 'vasp.example',
        },
      ])
      .on('UPDATE travel_rule_transfers', []);

    const service = new TravelRuleService(db, async () => ({ ok: true }), fixedNow);
    const result = await service.transmitOne('tx-1');

    expect(result.status).toBe('transmitted');
    const [update] = db.find('UPDATE travel_rule_transfers');
    expect(update.params[0]).toBe('transmitted');
    expect(update.params[2]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes a counterparty rejection from a transport failure', async () => {
    const row = {
      transaction_id: 'tx-1',
      originator: { name: 'Alice', accountIdentifier: 'GALICE', address: '1 Main St' },
      beneficiary: { name: 'Bob', accountIdentifier: 'GBOB' },
      amount: '5000',
      currency: 'USDC',
      counterparty_vasp: null,
    };

    const rejectDb = new FakeDb()
      .on('FROM travel_rule_transfers WHERE transaction_id', [row])
      .on('UPDATE travel_rule_transfers', []);
    const rejected = await new TravelRuleService(
      rejectDb,
      async () => ({ ok: false, rejected: true, error: 'beneficiary unknown' }),
      fixedNow,
    ).transmitOne('tx-1');
    expect(rejected.status).toBe('rejected');

    const failDb = new FakeDb()
      .on('FROM travel_rule_transfers WHERE transaction_id', [row])
      .on('UPDATE travel_rule_transfers', []);
    const failed = await new TravelRuleService(
      failDb,
      async () => ({ ok: false, error: 'timeout' }),
      fixedNow,
    ).transmitOne('tx-1');
    expect(failed.status).toBe('failed');
  });

  it('leaves a record pending when no transmitter is configured', async () => {
    const db = new FakeDb()
      .on('FROM travel_rule_transfers WHERE transaction_id', [
        {
          transaction_id: 'tx-1',
          originator: '{"name":"Alice","accountIdentifier":"GALICE"}',
          beneficiary: '{"name":"Bob","accountIdentifier":"GBOB"}',
          amount: '5000',
          currency: 'USDC',
          counterparty_vasp: null,
        },
      ])
      .on('UPDATE travel_rule_transfers', []);

    const result = await new TravelRuleService(db).transmitOne('tx-1');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/No travel-rule transmitter configured/);
  });

  it('404s when there is nothing pending for the transaction', async () => {
    const db = new FakeDb().on('FROM travel_rule_transfers WHERE transaction_id', []);
    await expect(new TravelRuleService(db).transmitOne('tx-missing')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

// ===========================================================================
// Retention
// ===========================================================================

describe('SR-112 data retention', () => {
  function policy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
    return {
      entity: 'compliance_report_audit',
      retentionDays: 730,
      legalBasis: 'internal',
      action: 'delete',
      enabled: true,
      lastEnforcedAt: null,
      ...overrides,
    };
  }

  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it('computes the cutoff from the retention period', () => {
    const service = new RetentionService(db, fixedNow);
    const cutoff = service.cutoffFor(policy({ retentionDays: 1826 }));
    expect(AT.getTime() - cutoff.getTime()).toBe(1826 * 86_400_000);
  });

  it('deletes rows past the cutoff and logs the run', async () => {
    db.on('DELETE FROM compliance_report_audit', [], 12);
    const service = new RetentionService(db, fixedNow);
    const result = await service.enforcePolicy(policy());

    expect(result).toMatchObject({ succeeded: true, rowsAffected: 12, action: 'delete' });
    const [del] = db.find('DELETE FROM compliance_report_audit');
    expect(del.text.replace(/\s+/g, ' ')).toContain('WHERE accessed_at < $1');
    expect(db.find('INSERT INTO data_retention_runs')).toHaveLength(1);
    expect(db.find('SET last_enforced_at = NOW()')).toHaveLength(1);
  });

  it('anonymises instead of deleting when the policy says so', async () => {
    db.on('UPDATE user_kyc_status', [], 3);
    const service = new RetentionService(db, fixedNow);
    const result = await service.enforcePolicy(
      policy({ entity: 'user_kyc_status', action: 'anonymize', retentionDays: 1826 }),
    );

    expect(result).toMatchObject({ succeeded: true, action: 'anonymize', rowsAffected: 3 });
    const [update] = db.find('UPDATE user_kyc_status');
    expect(update.text).toContain('REDACTED:');
  });

  it('applies the guard that protects live records', async () => {
    db.on('DELETE FROM aml_alerts', [], 1);
    const service = new RetentionService(db, fixedNow);
    await service.enforcePolicy(policy({ entity: 'aml_alerts', retentionDays: 1826 }));

    const [del] = db.find('DELETE FROM aml_alerts');
    const sql = del.text.replace(/\s+/g, ' ');
    expect(sql).toContain("status IN ('closed_no_action', 'reported')");
    expect(sql).toContain('FROM sar_reports');
  });

  it('skips a disabled policy without touching the database', async () => {
    const service = new RetentionService(db, fixedNow);
    const result = await service.enforcePolicy(policy({ enabled: false }));

    expect(result).toMatchObject({ succeeded: true, skippedReason: 'policy_disabled' });
    expect(db.calls).toHaveLength(0);
  });

  it('refuses an entity with no enforcement plan rather than guessing a table name', async () => {
    const service = new RetentionService(db, fixedNow);
    const result = await service.enforcePolicy(policy({ entity: 'arbitrary_table' }));

    expect(result.succeeded).toBe(false);
    expect(result.error).toMatch(/No enforcement plan/);
    expect(db.find('DELETE FROM')).toHaveLength(0);
  });

  it('records a failure instead of throwing', async () => {
    db.onThrow('DELETE FROM compliance_report_audit', new Error('permission denied'));
    const service = new RetentionService(db, fixedNow);
    const result = await service.enforcePolicy(policy());

    expect(result.succeeded).toBe(false);
    expect(result.error).toBe('permission denied');
    expect(db.find('INSERT INTO data_retention_runs')).toHaveLength(1);
  });

  it('covers every seeded policy entity with an enforcement plan', () => {
    // Mirrors the seed list in migrations/add_aml_ctf_controls.sql. A new
    // policy row without a plan would silently never be enforced.
    const seeded = [
      'sanctions_screening_results',
      'aml_alerts',
      'sar_reports',
      'travel_rule_transfers',
      'compliance_report_audit',
      'user_kyc_status',
    ];
    for (const entity of seeded) {
      expect(ENTITY_PLANS[entity], `missing enforcement plan for ${entity}`).toBeDefined();
    }
  });

  it('defines an anonymisation rule for every plan that could be asked to anonymise', () => {
    // Only user_kyc_status is seeded as 'anonymize'; assert it has a SET clause.
    expect(ENTITY_PLANS.user_kyc_status.anonymizeSet).toBeTruthy();
  });

  it('enforces the whole schedule in one pass', async () => {
    db.on('FROM data_retention_policies ORDER BY entity', [
      { entity: 'compliance_report_audit', retention_days: 730, legal_basis: 'x', action: 'delete', enabled: true, last_enforced_at: null },
      { entity: 'travel_rule_transfers', retention_days: 1826, legal_basis: 'y', action: 'delete', enabled: true, last_enforced_at: null },
    ]).on('DELETE FROM', [], 2);

    const service = new RetentionService(db, fixedNow);
    const results = await service.enforceAll();

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.succeeded)).toBe(true);
  });
});
