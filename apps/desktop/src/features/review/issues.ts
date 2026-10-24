import type { IssueRow } from '../../lib/ipc';

export const PRIORITIES = ['', 'low', 'normal', 'high', 'critical'];
export const ISSUE_STATUSES = ['open', 'in progress', 'resolved', 'closed'];

/** Resolved and closed issues are finished; everything else counts as open. */
export function isOpen(issue: Pick<IssueRow, 'status'>): boolean {
  return issue.status !== 'closed' && issue.status !== 'resolved';
}

export function isOverdue(issue: Pick<IssueRow, 'status' | 'due'>, now = Date.now()): boolean {
  return isOpen(issue) && !!issue.due && new Date(issue.due).getTime() < now;
}
