import type { Db } from './database/db.js';
import { MatchRepository } from './repositories/match.repository.js';
import { ProfileRepository } from './repositories/profile.repository.js';
import { QuestRepository } from './repositories/quest.repository.js';
import { QueueRepository } from './repositories/queue.repository.js';
import { type FetchLike, MaritimeClient, type QuestGenerator } from './services/maritime.service.js';
import { MatchService } from './services/match.service.js';
import { MatchmakingService } from './services/matchmaking.service.js';
import { NotificationService } from './services/notification.service.js';
import { ProfileService } from './services/profile.service.js';
import { QuestService } from './services/quest.service.js';
import { type Clock, systemClock } from './utils/clock.js';
import { type Logger, silentLogger } from './utils/logger.js';

export interface ServiceOptions {
  db: Db;
  clock?: Clock;
  logger?: Logger;
  matchRelaxAfterSeconds?: number;
  maritime?: { url?: string | undefined; apiKey?: string | undefined; timeoutMs?: number; fetch?: FetchLike };
  /** Override the quest generator entirely (rarely needed; prefer injecting `maritime.fetch`). */
  questGenerator?: QuestGenerator | null;
  n8n?: {
    webhookUrl?: string | undefined;
    secret?: string | undefined;
    timeoutMs?: number;
    maxAttempts?: number;
    fetch?: FetchLike;
  };
}

export interface Services {
  db: Db;
  profiles: ProfileService;
  matchmaking: MatchmakingService;
  quests: QuestService;
  matches: MatchService;
  notifier: NotificationService;
  repos: { profiles: ProfileRepository; queue: QueueRepository; matches: MatchRepository; quests: QuestRepository };
  /** Wait for background quest generation and webhook deliveries to settle. */
  whenIdle(): Promise<void>;
}

/** Wires repositories and services together. Used by server.ts and by tests. */
export function createServices(opts: ServiceOptions): Services {
  const clock = opts.clock ?? systemClock;
  const logger = opts.logger ?? silentLogger;
  const repos = {
    profiles: new ProfileRepository(opts.db),
    queue: new QueueRepository(opts.db),
    matches: new MatchRepository(opts.db),
    quests: new QuestRepository(opts.db),
  };

  const notifier = new NotificationService({
    db: opts.db,
    webhookUrl: opts.n8n?.webhookUrl,
    secret: opts.n8n?.secret,
    timeoutMs: opts.n8n?.timeoutMs ?? 5_000,
    maxAttempts: opts.n8n?.maxAttempts ?? 8,
    clock,
    logger,
    ...(opts.n8n?.fetch ? { fetch: opts.n8n.fetch } : {}),
  });

  const generator =
    opts.questGenerator !== undefined
      ? opts.questGenerator
      : opts.maritime?.url
        ? new MaritimeClient({
            url: opts.maritime.url,
            apiKey: opts.maritime.apiKey,
            timeoutMs: opts.maritime.timeoutMs ?? 10_000,
            ...(opts.maritime.fetch ? { fetch: opts.maritime.fetch } : {}),
          })
        : null;

  const quests = new QuestService({ db: opts.db, ...repos, notifier, generator, clock, logger });
  const matchmaking = new MatchmakingService({
    db: opts.db,
    profiles: repos.profiles,
    queue: repos.queue,
    matches: repos.matches,
    notifier,
    clock,
    relaxAfterSeconds: opts.matchRelaxAfterSeconds ?? 45,
    onMatchCreated: (match) => void quests.ensureGeneration(match.id),
  });

  return {
    db: opts.db,
    profiles: new ProfileService(repos.profiles, clock),
    matchmaking,
    quests,
    matches: new MatchService(opts.db, repos.matches, notifier, clock),
    notifier,
    repos,
    async whenIdle() {
      await quests.whenIdle();
      await notifier.whenIdle();
    },
  };
}
