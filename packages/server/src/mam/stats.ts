// The MAM account's ratio and unsatisfied-torrent count, for the bar at the
// top of Lectern.
//
// Polite by design: pages only ever read the last saved answer. MAM is asked
// in the background once an hour, and "Refresh" can ask again at most every
// 5 minutes (for the whole server, not per person).
import type { MamStats, MamStatsResponse } from '@lectern/shared';
import { getSetting, setSetting, type Db } from '../db.js';
import type { MamClient } from './client.js';

const STORED = 'mam.stats';
const STORED_PROBLEM = 'mam.stats.problem';
export const CHECK_EVERY_MS = 60 * 60 * 1000;
export const REFRESH_GAP_MS = 5 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;

export class MamStatsService {
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
  private lastAskedAt = 0;
  private running?: Promise<void>;

  constructor(
    private readonly o: { db: Db; mam: MamClient; now?: () => number; log?: { warn: (obj: object, msg: string) => void } },
  ) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** The saved stats. Never contacts MAM. */
  read(): MamStatsResponse {
    const raw = getSetting(this.o.db, STORED);
    let stats: MamStats | null = null;
    try {
      stats = raw ? (JSON.parse(raw) as MamStats) : null;
    } catch {
      stats = null;
    }
    const problem = getSetting(this.o.db, STORED_PROBLEM) || undefined;
    return { stats, ...(problem ? { problem } : {}), refreshAllowedAt: this.lastAskedAt + REFRESH_GAP_MS };
  }

  /** Ask MAM now. "manual" refreshes are refused within 5 minutes of the last ask. */
  async refresh(manual = false): Promise<MamStatsResponse> {
    if (!this.o.mam.isConfigured()) return this.read();
    if (manual && this.now() < this.lastAskedAt + REFRESH_GAP_MS) return this.read();
    // Two refreshes at once share one MAM request.
    this.running ??= this.ask().finally(() => (this.running = undefined));
    await this.running;
    return this.read();
  }

  private async ask(): Promise<void> {
    this.lastAskedAt = this.now();
    try {
      const s = await this.o.mam.accountStats();
      const stats: MamStats = { ...s, checkedAt: this.now() };
      setSetting(this.o.db, STORED, JSON.stringify(stats));
      setSetting(this.o.db, STORED_PROBLEM, '');
    } catch (err) {
      setSetting(this.o.db, STORED_PROBLEM, (err as Error).message);
      this.o.log?.warn({ err: (err as Error).message }, 'Couldn’t check MAM account stats');
    }
  }

  /** Check a couple of minutes after starting, then hourly. */
  start(): void {
    this.first = setTimeout(() => void this.refresh(), FIRST_CHECK_AFTER_MS);
    this.first.unref();
    this.timer = setInterval(() => void this.refresh(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
