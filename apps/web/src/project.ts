// A project's shared content, rebuilt in the browser from the change records the server
// holds: for every row, the newest change wins — the same rule the desktop applies.

import type { Change, FileNotice } from './api';

export interface Issue {
  id: string;
  bcf_guid: string;
  title: string;
  status: string;
  priority: string | null;
  assignee: string | null;
  due: string | null;
  created_by: string;
  created_at: string;
  description: string | null;
  topic_type: string | null;
  labels_json: string | null;
  stage: string | null;
  modified_at: string | null;
  modified_by: string | null;
  idx: number | null;
}

export interface Comment {
  id: string;
  issue_id: string;
  author: string;
  text: string;
  viewpoint_id: string | null;
  created_at: string;
  modified_at: string | null;
}

export interface Viewpoint {
  id: string;
  issue_id: string;
  guid: string;
  camera_json: string;
  components_json: string;
  lines_json: string;
  clipping_json: string;
  /** Image bytes as hex, as the change log carries blobs. */
  snapshot: string | null;
  created_at: string;
}

export interface ElementStatus {
  element_global_id: string;
  stage: string;
  set_by: string;
  set_at: string;
  note: string | null;
}

interface RowState {
  hlc: string;
  id: string;
  row: Record<string, unknown> | null;
}

/** Issue states, as on the desktop; resolved and closed issues are done. */
export const ISSUE_STATUSES = ['open', 'in progress', 'resolved', 'closed'];

export function isOpen(issue: { status: string }): boolean {
  return issue.status !== 'closed' && issue.status !== 'resolved';
}

/** Whether change `a` sorts after `b`: clock first, then change id. */
export function newer(a: { hlc: string; id: string }, b: { hlc: string; id: string }): boolean {
  return a.hlc > b.hlc || (a.hlc === b.hlc && a.id > b.id);
}

export class ProjectData {
  private readonly tables = new Map<string, Map<string, RowState>>();
  /** The newest clock seen, so changes made here sort after everything known. */
  newest = '';

  apply(changes: Change[]): void {
    for (const change of changes) {
      if (change.hlc > this.newest) this.newest = change.hlc;
      let table = this.tables.get(change.tbl);
      if (!table) {
        table = new Map();
        this.tables.set(change.tbl, table);
      }
      const key = JSON.stringify(change.pk);
      const current = table.get(key);
      if (current && !newer(change, current)) continue;
      table.set(key, {
        hlc: change.hlc,
        id: change.id,
        row: change.op === 'delete' ? null : (change.row ?? null),
      });
    }
  }

  rows<T>(table: string): T[] {
    const rows: T[] = [];
    for (const state of this.tables.get(table)?.values() ?? []) {
      if (state.row) rows.push(state.row as T);
    }
    return rows;
  }

  /** Issues newest first; two copies that imported the same BCF topic show it once. */
  issues(): Issue[] {
    const byGuid = new Map<string, Issue>();
    for (const issue of this.rows<Issue>('issue')) {
      const seen = byGuid.get(issue.bcf_guid);
      if (!seen || (issue.modified_at ?? issue.created_at) > (seen.modified_at ?? seen.created_at))
        byGuid.set(issue.bcf_guid, issue);
    }
    return [...byGuid.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  comments(issueId: string): Comment[] {
    return this.rows<Comment>('issue_comment')
      .filter((c) => c.issue_id === issueId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  viewpoints(issueId: string): Viewpoint[] {
    return this.rows<Viewpoint>('issue_viewpoint')
      .filter((v) => v.issue_id === issueId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  issueElements(issueId: string): string[] {
    return this.rows<{ issue_id: string; element_global_id: string }>('issue_element')
      .filter((e) => e.issue_id === issueId)
      .map((e) => e.element_global_id);
  }

  statuses(): ElementStatus[] {
    return this.rows<ElementStatus>('element_status');
  }
}

/** The same clock format as the desktop: milliseconds, counter, device. */
export class Clock {
  private ms = 0;
  private counter = 0;

  constructor(readonly device: string) {}

  observe(hlc: string): void {
    const [ms, counter] = hlc.split('.', 2).map(Number);
    if (ms === undefined || counter === undefined || Number.isNaN(ms) || Number.isNaN(counter))
      return;
    if (ms > this.ms || (ms === this.ms && counter > this.counter)) {
      this.ms = ms;
      this.counter = counter;
    }
  }

  next(now = Date.now()): string {
    if (now > this.ms) {
      this.ms = now;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return `${String(this.ms).padStart(13, '0')}.${String(this.counter).padStart(6, '0')}.${this.device}`;
  }
}

export function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Element GlobalIds by express id, read straight from the IFC text: every rooted entity
 * starts with its GlobalId, `#123=IFCBEAM('2O2Fr$t4X7Zf8NOew3FLOH',...`.
 */
export function readGlobalIds(text: string): Map<string, number> {
  const byGlobalId = new Map<string, number>();
  const pattern = /#(\d+)\s*=\s*IFC[A-Z0-9_]+\s*\(\s*'([0-9A-Za-z_$]{22})'/g;
  for (const match of text.matchAll(pattern)) {
    byGlobalId.set(match[2]!, Number(match[1]));
  }
  return byGlobalId;
}

/** The newest version of each model file, largest first (usually the main model). */
export function latestModels(notices: FileNotice[]): FileNotice[] {
  const byPath = new Map<string, FileNotice>();
  for (const notice of notices) {
    if (notice.kind !== 'ifc') continue;
    const seen = byPath.get(notice.rel_path);
    if (!seen || notice.published_at > seen.published_at) byPath.set(notice.rel_path, notice);
  }
  return [...byPath.values()].sort((a, b) => b.size - a.size);
}

/** A viewpoint snapshot (hex-encoded image bytes) as a data URL. */
export function snapshotUrl(raw: string | null): string | null {
  // SQLite writes hex in capitals; either case is fine.
  const hex = raw?.toLowerCase();
  if (!hex || hex.length < 8 || hex.length % 2) return null;
  const mime = hex.startsWith('89504e47')
    ? 'image/png'
    : hex.startsWith('ffd8')
      ? 'image/jpeg'
      : null;
  if (!mime) return null;
  let binary = '';
  for (let i = 0; i < hex.length; i += 2)
    binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return `data:${mime};base64,${btoa(binary)}`;
}

/** A change adding a comment, as the desktop would record it. */
export function commentChange(
  clock: Clock,
  issueId: string,
  author: string,
  text: string,
  now = new Date(),
): Change {
  const id = randomHex(16);
  return {
    id: randomHex(16),
    hlc: clock.next(now.getTime()),
    device: clock.device,
    tbl: 'issue_comment',
    pk: [id],
    op: 'upsert',
    row: {
      id,
      issue_id: issueId,
      author,
      text,
      viewpoint_id: null,
      created_at: now.toISOString(),
      modified_at: null,
    },
  };
}

/** A change setting an issue's status, keeping every other field. */
export function statusChange(
  clock: Clock,
  issue: Issue,
  status: string,
  by: string,
  now = new Date(),
): Change {
  return {
    id: randomHex(16),
    hlc: clock.next(now.getTime()),
    device: clock.device,
    tbl: 'issue',
    pk: [issue.id],
    op: 'upsert',
    row: { ...issue, status, modified_at: now.toISOString(), modified_by: by },
  };
}
