import { randomUUID } from 'node:crypto';

/** Prefixed random ids, e.g. `match_6f1c...`, so ids are recognisable in logs. */
export const newId = (prefix: 'queue' | 'match' | 'quest' | 'evt'): string =>
  `${prefix}_${randomUUID().replaceAll('-', '')}`;
