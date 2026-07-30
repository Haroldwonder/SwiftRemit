/**
 * SR-112 — sanctions and PEP screening.
 *
 * Screens senders, recipients and agents against the locally mirrored
 * screening lists (`sanctions_list_entries`) at onboarding and then on a
 * recurring cycle. Every run is persisted to `sanctions_screening_results`;
 * anything that is not a clean pass raises an alert into the review queue.
 *
 * Nothing here auto-confirms a match. A machine decision of `block` stops the
 * onboarding flow, but the compliance officer still has to dispose of the
 * alert — `confirmed_match` is only ever written by a human review.
 */

import { Queryable, SubjectType } from './types';
import { raiseAlert } from './alerts';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ScreeningConfig {
  /** Similarity at or above which a candidate becomes a potential match. */
  reviewScore: number;
  /** Similarity at or above which a sanctions (not PEP) hit blocks onboarding. */
  blockScore: number;
  /** Days between periodic rescreens of an active subject. */
  rescreenIntervalDays: number;
  /** Maximum candidates recorded per run. */
  maxMatches: number;
}

export const DEFAULT_SCREENING_CONFIG: ScreeningConfig = {
  reviewScore: 0.85,
  blockScore: 0.98,
  rescreenIntervalDays: 90,
  maxMatches: 20,
};

export type ScreeningTrigger = 'onboarding' | 'periodic' | 'manual' | 'transaction';
export type ScreeningOutcome = 'clear' | 'potential_match' | 'confirmed_match' | 'error';
export type ScreeningDecision = 'allow' | 'review' | 'block';

export interface ScreeningSubject {
  subjectType: SubjectType;
  subjectId: string;
  name: string;
  country?: string;
  dateOfBirth?: string;
}

export interface ScreeningMatch {
  entryId: number;
  listSource: string;
  entryType: 'sanctions' | 'pep';
  matchedName: string;
  matchedOn: 'name' | 'alias';
  score: number;
  country: string | null;
  program: string | null;
}

export interface ScreeningResult {
  screeningId: number | null;
  subject: ScreeningSubject;
  trigger: ScreeningTrigger;
  outcome: ScreeningOutcome;
  decision: ScreeningDecision;
  highestScore: number;
  matches: ScreeningMatch[];
  listsScreened: string[];
  screenedAt: Date;
  nextScreeningAt: Date;
  alertId?: number;
}

// ─── Name normalisation and similarity ──────────────────────────────────────

const NAME_NOISE = new Set([
  'MR', 'MRS', 'MS', 'DR', 'PROF', 'SIR', 'THE', 'AKA', 'FKA',
  'JR', 'SR', 'II', 'III',
]);

/**
 * Upper-case, strip diacritics and punctuation, drop honorifics, collapse
 * whitespace. Screening lists are wildly inconsistent about all four.
 */
export function normalizeName(raw: string): string {
  const folded = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = folded.split(' ').filter((t) => t.length > 0 && !NAME_NOISE.has(t));
  return tokens.join(' ');
}

/** Levenshtein edit distance, iterative two-row form. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Similarity in [0, 1] between two already-normalised names.
 *
 * Combines two signals and takes the stronger: character-level edit similarity
 * (catches transliteration noise, e.g. MOHAMMED/MUHAMMAD) and token-set
 * similarity (catches reordering and missing middle names, e.g.
 * "SMITH JOHN" vs "JOHN QUINCY SMITH").
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const longest = Math.max(a.length, b.length);
  const charScore = 1 - editDistance(a, b) / longest;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared += 1;
  // Jaccard-style but weighted toward the smaller set, so a full-name query
  // still matches a two-token list entry.
  const tokenScore = shared === 0 ? 0 : shared / Math.min(aTokens.size, bTokens.size);
  // A pure token-containment score of 1 on a single shared token is too weak
  // to stand alone — require at least two shared tokens for full credit.
  const adjustedTokenScore = shared >= 2 ? tokenScore : tokenScore * 0.8;

  return Math.max(0, Math.min(1, Math.max(charScore, adjustedTokenScore)));
}

interface ListEntryRow {
  id: number;
  list_source: string;
  entry_type: 'sanctions' | 'pep';
  full_name: string;
  normalized_name: string;
  aliases: unknown;
  country: string | null;
  date_of_birth: string | null;
  program: string | null;
}

function parseAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Score one subject against one list entry, considering the primary name and
 * every alias. Pure function — exported for unit testing.
 */
export function scoreEntry(
  subject: ScreeningSubject,
  entry: ListEntryRow,
  config: ScreeningConfig = DEFAULT_SCREENING_CONFIG,
): ScreeningMatch | null {
  const normalizedSubject = normalizeName(subject.name);
  if (!normalizedSubject) return null;

  let best = nameSimilarity(normalizedSubject, entry.normalized_name || normalizeName(entry.full_name));
  let matchedName = entry.full_name;
  let matchedOn: 'name' | 'alias' = 'name';

  for (const alias of parseAliases(entry.aliases)) {
    const score = nameSimilarity(normalizedSubject, normalizeName(alias));
    if (score > best) {
      best = score;
      matchedName = alias;
      matchedOn = 'alias';
    }
  }

  // A date-of-birth mismatch on both sides is a strong discriminator; a match
  // is a strong confirmer. Nudge rather than override, because list DOBs are
  // frequently absent or approximate.
  if (subject.dateOfBirth && entry.date_of_birth) {
    best = subject.dateOfBirth === entry.date_of_birth
      ? Math.min(1, best + 0.05)
      : best * 0.9;
  }

  if (best < config.reviewScore) return null;

  return {
    entryId: entry.id,
    listSource: entry.list_source,
    entryType: entry.entry_type,
    matchedName,
    matchedOn,
    score: Number(best.toFixed(4)),
    country: entry.country,
    program: entry.program,
  };
}

/**
 * Machine decision from a set of candidate matches. PEP hits never auto-block:
 * being a politically exposed person is a trigger for enhanced due diligence,
 * not a prohibition.
 */
export function decideOutcome(
  matches: ScreeningMatch[],
  config: ScreeningConfig = DEFAULT_SCREENING_CONFIG,
): { outcome: ScreeningOutcome; decision: ScreeningDecision; highestScore: number } {
  if (matches.length === 0) {
    return { outcome: 'clear', decision: 'allow', highestScore: 0 };
  }
  const highestScore = matches.reduce((m, c) => Math.max(m, c.score), 0);
  const blocking = matches.some(
    (m) => m.entryType === 'sanctions' && m.score >= config.blockScore,
  );
  return {
    outcome: 'potential_match',
    decision: blocking ? 'block' : 'review',
    highestScore,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export class SanctionsScreeningService {
  constructor(
    private readonly db: Queryable,
    private readonly config: ScreeningConfig = DEFAULT_SCREENING_CONFIG,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Screen one subject and persist the result. Raises an alert when the run is
   * anything other than clear.
   */
  async screen(
    subject: ScreeningSubject,
    trigger: ScreeningTrigger = 'onboarding',
  ): Promise<ScreeningResult> {
    const screenedAt = this.now();
    const nextScreeningAt = new Date(
      screenedAt.getTime() + this.config.rescreenIntervalDays * 86_400_000,
    );

    const { rows: entries } = await this.db.query<ListEntryRow>(
      `SELECT id, list_source, entry_type, full_name, normalized_name,
              aliases, country, date_of_birth, program
         FROM sanctions_list_entries
        WHERE active = TRUE`,
    );

    const matches: ScreeningMatch[] = [];
    for (const entry of entries) {
      const match = scoreEntry(subject, entry, this.config);
      if (match) matches.push(match);
    }
    matches.sort((a, b) => b.score - a.score);
    const kept = matches.slice(0, this.config.maxMatches);

    const listsScreened = [...new Set(entries.map((e) => e.list_source))].sort();
    const { outcome, decision, highestScore } = decideOutcome(kept, this.config);

    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO sanctions_screening_results
         (subject_type, subject_id, subject_name, subject_country, trigger,
          outcome, highest_score, matches, lists_screened, screened_at, next_screening_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       RETURNING id`,
      [
        subject.subjectType,
        subject.subjectId,
        subject.name,
        subject.country ?? null,
        trigger,
        outcome,
        highestScore,
        JSON.stringify(kept),
        JSON.stringify(listsScreened),
        screenedAt,
        nextScreeningAt,
      ],
    );
    const screeningId = rows[0]?.id ?? null;

    const result: ScreeningResult = {
      screeningId,
      subject,
      trigger,
      outcome,
      decision,
      highestScore,
      matches: kept,
      listsScreened,
      screenedAt,
      nextScreeningAt,
    };

    if (outcome !== 'clear') {
      const alert = await raiseAlert(this.db, {
        ruleCode: 'SANCTIONS_HIT',
        severity: decision === 'block' ? 'critical' : 'high',
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        screeningId,
        // One open alert per subject per screening run.
        dedupeKey: `SANCTIONS_HIT:${subject.subjectType}:${subject.subjectId}:${screeningId ?? screenedAt.toISOString()}`,
        details: {
          trigger,
          decision,
          highest_score: highestScore,
          matches: kept,
          subject_name: subject.name,
        },
      });
      if (alert) result.alertId = alert;
    }

    return result;
  }

  /**
   * Subjects whose periodic rescreen is due. Returns the latest screening row
   * per subject so a subject is not re-queued once rescreened.
   */
  async findDueForRescreening(limit = 200): Promise<ScreeningSubject[]> {
    const { rows } = await this.db.query<{
      subject_type: SubjectType;
      subject_id: string;
      subject_name: string;
      subject_country: string | null;
    }>(
      `SELECT DISTINCT ON (subject_type, subject_id)
              subject_type, subject_id, subject_name, subject_country
         FROM sanctions_screening_results
        WHERE next_screening_at IS NOT NULL
          AND next_screening_at <= $1
        ORDER BY subject_type, subject_id, screened_at DESC
        LIMIT $2`,
      [this.now(), limit],
    );

    return rows.map((r) => ({
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      name: r.subject_name,
      country: r.subject_country ?? undefined,
    }));
  }

  /**
   * Run the periodic rescreening cycle. Individual failures are recorded and
   * skipped so one bad subject cannot stall the batch.
   */
  async runPeriodicRescreening(limit = 200): Promise<{
    screened: number;
    hits: number;
    errors: number;
  }> {
    const due = await this.findDueForRescreening(limit);
    let screened = 0;
    let hits = 0;
    let errors = 0;

    for (const subject of due) {
      try {
        const result = await this.screen(subject, 'periodic');
        screened += 1;
        if (result.outcome !== 'clear') hits += 1;
      } catch {
        errors += 1;
      }
    }

    return { screened, hits, errors };
  }

  /** Most recent screening result for a subject, or null if never screened. */
  async latestFor(subjectType: SubjectType, subjectId: string): Promise<{
    outcome: ScreeningOutcome;
    highest_score: string | number;
    screened_at: Date;
    next_screening_at: Date | null;
  } | null> {
    const { rows } = await this.db.query(
      `SELECT outcome, highest_score, screened_at, next_screening_at
         FROM sanctions_screening_results
        WHERE subject_type = $1 AND subject_id = $2
        ORDER BY screened_at DESC
        LIMIT 1`,
      [subjectType, subjectId],
    );
    return rows[0] ?? null;
  }
}
