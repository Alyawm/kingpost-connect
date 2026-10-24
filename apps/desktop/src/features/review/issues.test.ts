import { isOpen, isOverdue } from './issues';

describe('issue state helpers', () => {
  it('treats resolved and closed as finished', () => {
    expect(isOpen({ status: 'open' })).toBe(true);
    expect(isOpen({ status: 'in progress' })).toBe(true);
    expect(isOpen({ status: 'resolved' })).toBe(false);
    expect(isOpen({ status: 'closed' })).toBe(false);
  });

  it('marks open issues with a past due date as overdue', () => {
    const now = new Date('2026-10-24T12:00:00Z').getTime();
    expect(isOverdue({ status: 'open', due: '2026-10-23T00:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'open', due: '2026-10-25T00:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'closed', due: '2026-10-23T00:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'open', due: null }, now)).toBe(false);
  });
});
