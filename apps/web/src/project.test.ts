import type { Change, FileNotice } from './api';
import {
  Clock,
  ProjectData,
  commentChange,
  isOpen,
  latestModels,
  newer,
  readGlobalIds,
  snapshotUrl,
  statusChange,
  type Issue,
} from './project';

function change(partial: Partial<Change> & Pick<Change, 'hlc' | 'tbl' | 'pk'>): Change {
  return { id: `c-${partial.hlc}`, device: 'd1', op: 'upsert', row: null, ...partial };
}

const issue = (status: string, extra: Partial<Issue> = {}): Record<string, unknown> => ({
  id: 'i1',
  bcf_guid: 'g1',
  title: 'Check B12',
  status,
  created_by: 'Ann',
  created_at: '2026-10-26T08:00:00.000Z',
  ...extra,
});

describe('project data', () => {
  it('keeps the newest change of each row, whatever the order', () => {
    const data = new ProjectData();
    data.apply([
      change({ hlc: '0000000000002.000000.d1', tbl: 'issue', pk: ['i1'], row: issue('closed') }),
      change({ hlc: '0000000000001.000000.d1', tbl: 'issue', pk: ['i1'], row: issue('open') }),
    ]);
    expect(data.issues().map((i) => i.status)).toEqual(['closed']);
    expect(data.newest).toBe('0000000000002.000000.d1');
  });

  it('removes deleted rows', () => {
    const data = new ProjectData();
    data.apply([
      change({ hlc: '0000000000001.000000.d1', tbl: 'note', pk: ['n1'], row: { id: 'n1' } }),
      change({ hlc: '0000000000002.000000.d1', tbl: 'note', pk: ['n1'], op: 'delete' }),
    ]);
    expect(data.rows('note')).toEqual([]);
  });

  it('lists comments, viewpoints and elements of an issue', () => {
    const data = new ProjectData();
    data.apply([
      change({
        hlc: '0000000000002.000000.d1',
        tbl: 'issue_comment',
        pk: ['c2'],
        row: { id: 'c2', issue_id: 'i1', text: 'second', created_at: '2026-10-26T09:00:00Z' },
      }),
      change({
        hlc: '0000000000001.000000.d1',
        tbl: 'issue_comment',
        pk: ['c1'],
        row: { id: 'c1', issue_id: 'i1', text: 'first', created_at: '2026-10-26T08:00:00Z' },
      }),
      change({
        hlc: '0000000000003.000000.d1',
        tbl: 'issue_element',
        pk: ['i1', 'GUID'],
        row: { issue_id: 'i1', element_global_id: 'GUID' },
      }),
    ]);
    expect(data.comments('i1').map((c) => c.text)).toEqual(['first', 'second']);
    expect(data.issueElements('i1')).toEqual(['GUID']);
    expect(data.comments('other')).toEqual([]);
  });

  it('shows an issue imported on two copies once', () => {
    const data = new ProjectData();
    data.apply([
      change({
        hlc: '0000000000001.000000.d1',
        tbl: 'issue',
        pk: ['a'],
        row: issue('open', { id: 'a' }),
      }),
      change({
        hlc: '0000000000002.000000.d2',
        tbl: 'issue',
        pk: ['b'],
        row: issue('closed', { id: 'b', modified_at: '2026-10-26T10:00:00.000Z' }),
      }),
    ]);
    expect(data.issues().map((i) => i.id)).toEqual(['b']);
  });

  it('orders ties by change id', () => {
    expect(newer({ hlc: 'x', id: 'b' }, { hlc: 'x', id: 'a' })).toBe(true);
    expect(newer({ hlc: 'x', id: 'a' }, { hlc: 'y', id: 'z' })).toBe(false);
  });
});

describe('clock', () => {
  it('writes the desktop format and moves past what it has seen', () => {
    const clock = new Clock('web-abc');
    expect(clock.next(5)).toBe('0000000000005.000000.web-abc');
    expect(clock.next(5)).toBe('0000000000005.000001.web-abc');
    clock.observe('9999999999999.000003.d1');
    expect(clock.next(10)).toBe('9999999999999.000004.web-abc');
    clock.observe('nonsense');
    expect(clock.next(10)).toBe('9999999999999.000005.web-abc');
  });
});

describe('changes made on the web', () => {
  it('records a comment the way the desktop does', () => {
    const clock = new Clock('web-abc');
    const now = new Date('2026-10-26T12:00:00.000Z');
    const c = commentChange(clock, 'i1', 'Kim', 'Looks fine', now);
    expect(c.tbl).toBe('issue_comment');
    expect(c.device).toBe('web-abc');
    expect(c.id).toMatch(/^[0-9a-f]{32}$/);
    expect(c.pk).toEqual([c.row!.id]);
    expect(c.row).toMatchObject({
      issue_id: 'i1',
      author: 'Kim',
      text: 'Looks fine',
      created_at: '2026-10-26T12:00:00.000Z',
    });
  });

  it('changes a status and keeps the rest of the issue', () => {
    const clock = new Clock('web-abc');
    const before = issue('open', { description: 'Deflection' }) as unknown as Issue;
    const c = statusChange(clock, before, 'resolved', 'Kim');
    expect(c.row).toMatchObject({
      status: 'resolved',
      description: 'Deflection',
      modified_by: 'Kim',
    });
    expect(isOpen(c.row as unknown as Issue)).toBe(false);
  });
});

describe('model files', () => {
  it('reads GlobalIds from the IFC text', () => {
    const text = [
      "#12=IFCBEAM('2O2Fr$t4X7Zf8NOew3FLOH',#5,'B1',$,$,#20,#30,$,$);",
      "#13= IFCCOLUMN ( '0cFVBcKcz0kOLIGnvwbmOn',#5,'C1',$,$,#21,#31,$,$);",
      '#14=IFCCARTESIANPOINT((0.,0.,0.));',
    ].join('\n');
    const ids = readGlobalIds(text);
    expect(ids.get('2O2Fr$t4X7Zf8NOew3FLOH')).toBe(12);
    expect(ids.get('0cFVBcKcz0kOLIGnvwbmOn')).toBe(13);
    expect(ids.size).toBe(2);
  });

  it('offers the newest version of each model, largest first', () => {
    const notice = (
      rel_path: string,
      published_at: string,
      size: number,
      kind = 'ifc',
    ): FileNotice => ({
      rel_path,
      sha256: `${rel_path}-${published_at}`,
      kind,
      size,
      user: 'Ann',
      published_at,
      imported_at: null,
    });
    const models = latestModels([
      notice('frame.ifc', '2026-10-01', 10),
      notice('frame.ifc', '2026-10-02', 12),
      notice('site.ifc', '2026-10-01', 50),
      notice('GA.pdf', '2026-10-03', 99, 'pdf'),
    ]);
    expect(models.map((m) => `${m.rel_path}@${m.published_at}`)).toEqual([
      'site.ifc@2026-10-01',
      'frame.ifc@2026-10-02',
    ]);
  });

  it('turns snapshot bytes into an image address', () => {
    expect(snapshotUrl('89504e470d0a1a0a')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(snapshotUrl('89504E470D0A1A0A')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(snapshotUrl('ffd8ffe0')?.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(snapshotUrl('00112233')).toBeNull();
    expect(snapshotUrl(null)).toBeNull();
  });
});
