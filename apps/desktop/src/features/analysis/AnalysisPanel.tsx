import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Import,
  Link2,
  Link2Off,
  Palette,
  Play,
} from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import { MEMBER_KIND_COLORS } from '@kingpost/viewer';
import { SOURCE_LABELS, analysisFiles, useAnalysis } from '../../state/analysis';
import { useModel } from '../../state/model';
import { useProject } from '../../state/project';
import { LINK_COLORS, useView } from '../../state/view';
import type { AnalysisModel, Link, MemberForce } from '../../lib/ipc';
import { ForceDiagram } from './ForceDiagram';

const field = 'h-6 w-full rounded border border-edge bg-canvas px-1 text-xs';
const subtle = 'text-[10px] text-fg-muted';

export function AnalysisPanel() {
  const project = useProject((s) => s.current);
  const files = useProject((s) => s.files);
  const refreshFiles = useProject((s) => s.refreshFiles);
  const models = useAnalysis((s) => s.models);
  const refresh = useAnalysis((s) => s.refresh);
  const importFile = useAnalysis((s) => s.importFile);
  const importing = useAnalysis((s) => s.importing);
  const shown = useAnalysis((s) => s.shown);
  const loading = useAnalysis((s) => s.loading);
  const show = useAnalysis((s) => s.show);
  const hide = useAnalysis((s) => s.hide);

  useEffect(() => {
    if (project) void Promise.all([refreshFiles(), refresh()]);
  }, [project, refreshFiles, refresh]);

  const candidates = useMemo(() => analysisFiles(files), [files]);

  return (
    <Panel>
      <PanelHeader
        title="Analysis"
        actions={
          shown && (
            <IconButton label="Hide analysis model" size="sm" onClick={hide}>
              <EyeOff size={14} />
            </IconButton>
          )
        }
      />
      <PanelBody className="p-0 text-xs">
        {!project ? (
          <p className="p-3 text-fg-muted">Open a project to work with analysis models.</p>
        ) : (
          <>
            <div className="border-b border-edge px-3 py-2">
              <div className="mb-1 font-semibold text-fg-muted">Analysis files</div>
              {candidates.length === 0 && models.length === 0 && (
                <p className={subtle}>
                  Put an ETABS .e2k, SAP2000 .s2k or SAF .xlsx export in the project folder; IFC
                  files with a structural analysis view are picked up when imported.
                </p>
              )}
              <ul className="space-y-0.5">
                {candidates.map((f) => (
                  <li key={f.rel_path} className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate" title={f.rel_path}>
                      {f.rel_path}
                    </span>
                    <span className={subtle}>
                      {f.revisions.length ? `rev ${f.revisions.length}` : 'not imported'}
                    </span>
                    <button
                      type="button"
                      className="flex shrink-0 items-center gap-1 rounded border border-edge px-1 py-0.5 text-[10px] hover:bg-surface-2 disabled:opacity-50"
                      disabled={importing.has(f.rel_path)}
                      onClick={() => void importFile(f.rel_path)}
                      title={f.revisions.length ? 'Import again as a new revision' : 'Import'}
                    >
                      <Import size={11} />
                      {importing.has(f.rel_path) ? '…' : 'import'}
                    </button>
                  </li>
                ))}
              </ul>
              {models.length > 0 && (
                <>
                  <div className="mt-2 mb-1 font-semibold text-fg-muted">Models</div>
                  <ul className="space-y-0.5">
                    {models.map((m) => {
                      const active = shown?.revisionId === m.revision_id;
                      return (
                        <li key={m.revision_id} className="flex items-center gap-1">
                          <button
                            type="button"
                            className={cn(
                              'min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left hover:bg-surface-2',
                              active && 'bg-surface-3',
                            )}
                            disabled={loading}
                            onClick={() => void show(m.revision_id)}
                            title={`${m.rel_path} · ${SOURCE_LABELS[m.source] ?? m.source}${m.program ? ` · ${m.program}` : ''}`}
                          >
                            <span className="flex items-center gap-1">
                              <Activity size={11} className="shrink-0 text-fg-muted" />
                              <span className="truncate">{m.rel_path}</span>
                              <span className={subtle}>rev {m.revision_idx}</span>
                            </span>
                            <span className={cn(subtle, 'block truncate')}>
                              {SOURCE_LABELS[m.source] ?? m.source} · {m.member_count} members ·{' '}
                              {m.node_count} nodes
                              {m.result_count ? ` · ${m.result_count} results` : ''}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            {shown && <ShownModelSection />}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function ShownModelSection() {
  const shown = useAnalysis((s) => s.shown)!;
  const visibility = useAnalysis((s) => s.visibility);
  const setVisibility = useAnalysis((s) => s.setVisibility);
  const physicalVisible = useAnalysis((s) => s.physicalVisible);
  const setPhysicalVisible = useAnalysis((s) => s.setPhysicalVisible);
  const hasPhysical = useModel((s) => s.model !== null);
  const m = shown.model;

  const toggles: { key: keyof typeof visibility; label: string; count: number }[] = [
    { key: 'members', label: 'Members', count: m.members.length },
    { key: 'nodes', label: 'Nodes', count: m.nodes.length },
    { key: 'supports', label: 'Supports', count: m.supports.length },
    { key: 'loads', label: 'Loads', count: m.point_loads.length + m.line_loads.length },
    { key: 'surfaces', label: 'Surfaces', count: m.surfaces.length },
  ];

  return (
    <div>
      <div className="border-b border-edge px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{shown.summary.rel_path}</span>
          <span className={subtle}>
            {m.units.length} · {m.units.force}
          </span>
        </div>
        <div className={subtle}>
          {SOURCE_LABELS[m.source] ?? m.source}
          {m.program && ` · ${m.program}`}
          {m.storeys.length > 0 && ` · ${m.storeys.length} storeys`} · {m.load_cases.length} load
          cases · {m.combinations.length} combinations
          {m.results.length > 0 && ` · ${m.results.length.toLocaleString()} result rows`}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {toggles.map((t) => (
            <button
              key={t.key}
              type="button"
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px]',
                visibility[t.key] ? 'border-accent text-fg' : 'border-edge text-fg-muted',
              )}
              onClick={() => setVisibility({ [t.key]: !visibility[t.key] })}
            >
              {t.label} {t.count}
            </button>
          ))}
          <button
            type="button"
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px]',
              physicalVisible ? 'border-accent text-fg' : 'border-edge text-fg-muted',
            )}
            disabled={!hasPhysical}
            onClick={() => setPhysicalVisible(!physicalVisible)}
            title="Show or hide the physical model"
          >
            Physical model
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-fg-muted">
          {(['beam', 'column', 'brace', 'other'] as const).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: MEMBER_KIND_COLORS[kind] }}
              />
              {kind} {m.members.filter((x) => x.kind === kind).length}
            </span>
          ))}
        </div>
      </div>
      <LinkSection />
      <MemberSection />
      <CasesSection model={m} />
    </div>
  );
}

function LinkSection() {
  const shown = useAnalysis((s) => s.shown)!;
  const settings = useAnalysis((s) => s.settings);
  const setSettings = useAnalysis((s) => s.setSettings);
  const match = useAnalysis((s) => s.match);
  const matching = useAnalysis((s) => s.matching);
  const linkSet = useAnalysis((s) => s.linkSet);
  const linkSelection = useAnalysis((s) => s.linkSelection);
  const focusElement = useAnalysis((s) => s.focusElement);
  const selectMember = useAnalysis((s) => s.selectMember);
  const selectedMember = useAnalysis((s) => s.selectedMember);
  const physicalRevision = useModel((s) => s.revision);
  const selectedIds = useModel((s) => s.selectedIds);
  const byId = useModel((s) => s.byId);
  const colorBy = useView((s) => s.colorBy);
  const setColorBy = useView((s) => s.setColorBy);
  const [open, setOpen] = useState<'sections' | 'materials' | 'elements' | 'members' | null>(null);
  const [offsetText, setOffsetText] = useState(settings.offset.map(String));

  useEffect(() => {
    setOffsetText(settings.offset.map(String));
  }, [settings.offset]);

  const report = linkSet?.report;
  const selectedElement = selectedIds.size === 1 ? byId.get([...selectedIds][0]!) : undefined;
  const selectedLink = selectedElement
    ? report?.links.find((l) => l.global_id === selectedElement.global_id)
    : undefined;
  const sectionDiffs = report?.links.filter((l) => l.section_ok === false) ?? [];
  const materialDiffs = report?.links.filter((l) => l.material_ok === false) ?? [];

  const commitOffset = () => {
    const next = offsetText.map((t) => Number(t) || 0) as [number, number, number];
    if (next.some((v, i) => v !== settings.offset[i])) setSettings({ offset: next });
  };

  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="mb-1 font-semibold text-fg-muted">Physical ↔ analytical</div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
        <label className={subtle} htmlFor="kp-tolerance">
          Tolerance (m)
        </label>
        <input
          id="kp-tolerance"
          type="number"
          step="0.1"
          min="0.01"
          className={field}
          value={settings.tolerance}
          onChange={(e) =>
            setSettings({ tolerance: Math.max(0.01, Number(e.target.value) || 0.5) })
          }
        />
        <span className={subtle}>Offset x y z (m)</span>
        <div className="grid grid-cols-3 gap-1">
          {offsetText.map((t, i) => (
            <input
              key={i}
              type="number"
              step="0.1"
              className={field}
              aria-label={`Offset ${'xyz'[i]}`}
              value={t}
              onChange={(e) => {
                const copy = [...offsetText];
                copy[i] = e.target.value;
                setOffsetText(copy);
              }}
              onBlur={commitOffset}
              onKeyDown={(e) => e.key === 'Enter' && commitOffset()}
            />
          ))}
        </div>
        <label className={cn(subtle, 'col-span-2 flex items-center gap-1')}>
          <input
            type="checkbox"
            checked={settings.same_kind}
            onChange={(e) => setSettings({ same_kind: e.target.checked })}
          />
          only match beams with beams, columns with columns
        </label>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <Button
          variant="primary"
          size="sm"
          disabled={!physicalRevision || matching}
          onClick={() => void match()}
          title={
            physicalRevision
              ? 'Match the loaded IFC revision against this model'
              : 'Load an IFC revision first'
          }
        >
          <Play size={12} />
          {matching ? 'Matching…' : report ? 'Match again' : 'Match with loaded model'}
        </Button>
        {report && (
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
              colorBy === 'link' ? 'border-accent text-fg' : 'border-edge hover:bg-surface-2',
            )}
            onClick={() => setColorBy(colorBy === 'link' ? 'none' : 'link')}
            title="Colour the physical model by link status"
          >
            <Palette size={11} />
            by link
          </button>
        )}
      </div>
      {report && (
        <div className="mt-2">
          <div className="grid grid-cols-2 gap-1">
            <Counter
              label="Linked"
              value={report.links.length}
              color={LINK_COLORS.linked ?? '#888888'}
              hint={`of ${report.physical_count} elements and ${report.member_count} members`}
            />
            <Counter
              label="Section differs"
              value={report.section_mismatches}
              color={LINK_COLORS['section differs'] ?? '#888888'}
              active={open === 'sections'}
              onClick={() => setOpen(open === 'sections' ? null : 'sections')}
            />
            <Counter
              label="Material differs"
              value={report.material_mismatches}
              color={LINK_COLORS['material differs'] ?? '#888888'}
              active={open === 'materials'}
              onClick={() => setOpen(open === 'materials' ? null : 'materials')}
            />
            <Counter
              label="Unmatched elements"
              value={report.unmatched_physical.length}
              color={LINK_COLORS.unmatched ?? '#888888'}
              active={open === 'elements'}
              onClick={() => setOpen(open === 'elements' ? null : 'elements')}
            />
            <Counter
              label="Unmatched members"
              value={report.unmatched_members.length}
              color={LINK_COLORS.unmatched ?? '#888888'}
              active={open === 'members'}
              onClick={() => setOpen(open === 'members' ? null : 'members')}
            />
          </div>
          <p className={cn(subtle, 'mt-1')}>
            Matched {new Date(linkSet!.computed_at).toLocaleString()}; tolerance{' '}
            {linkSet!.settings.tolerance} m.
          </p>
          {open === 'sections' && (
            <LinkList
              links={sectionDiffs}
              render={(l) => `${l.physical_section ?? '—'} ≠ ${l.analysis_section ?? '—'}`}
              onPick={(l) => {
                focusElement(l.global_id);
                selectMember(l.member_uid);
              }}
            />
          )}
          {open === 'materials' && (
            <LinkList
              links={materialDiffs}
              render={(l) => `${l.physical_material ?? '—'} ≠ ${l.analysis_material ?? '—'}`}
              onPick={(l) => {
                focusElement(l.global_id);
                selectMember(l.member_uid);
              }}
            />
          )}
          {open === 'elements' && (
            <NameList
              items={report.unmatched_physical.map((g) => ({
                key: g,
                label: byId.get(useModel.getState().byGlobalId.get(g) ?? -1)?.name ?? g,
              }))}
              onPick={(key) => focusElement(key)}
            />
          )}
          {open === 'members' && (
            <NameList
              items={report.unmatched_members.map((uid) => ({
                key: uid,
                label: shown.model.members.find((x) => x.uid === uid)?.name ?? uid,
                hint: uid,
              }))}
              onPick={(key) => selectMember(key, true)}
            />
          )}
          <div className="mt-2 rounded border border-edge bg-canvas px-2 py-1.5">
            <div className={subtle}>
              {selectedElement
                ? selectedLink
                  ? `${selectedElement.name ?? selectedElement.global_id} is linked to ${selectedLink.member_uid} (${selectedLink.method})`
                  : `${selectedElement.name ?? selectedElement.global_id} is not linked`
                : 'Select one element and one member to link them by hand.'}
            </div>
            <div className="mt-1 flex gap-1">
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-[10px] hover:bg-surface-2 disabled:opacity-50"
                disabled={!selectedElement || !selectedMember}
                onClick={() => void linkSelection(selectedMember)}
                title={selectedMember ? `Link to ${selectedMember}` : 'Pick a member first'}
              >
                <Link2 size={11} />
                link to {selectedMember ?? 'member'}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-[10px] hover:bg-surface-2 disabled:opacity-50"
                disabled={!selectedLink}
                onClick={() => void linkSelection(null)}
              >
                <Link2Off size={11} />
                unlink
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  color,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cn(
        'rounded border px-1.5 py-1 text-left',
        active ? 'border-accent' : 'border-edge',
        onClick && 'hover:bg-surface-2',
      )}
      onClick={onClick}
      title={hint}
    >
      <div className="flex items-center gap-1 font-mono text-sm">
        <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
        {value.toLocaleString()}
      </div>
      <div className={subtle}>{label}</div>
    </Tag>
  );
}

function LinkList({
  links,
  render,
  onPick,
}: {
  links: Link[];
  render: (link: Link) => string;
  onPick: (link: Link) => void;
}) {
  if (links.length === 0) return <p className={cn(subtle, 'mt-1')}>None.</p>;
  return (
    <ul className="mt-1 max-h-48 overflow-auto rounded border border-edge">
      {links.slice(0, 300).map((l) => (
        <li key={l.global_id}>
          <button
            type="button"
            className="w-full px-2 py-1 text-left hover:bg-surface-2"
            onClick={() => onPick(l)}
          >
            <div className="truncate">{render(l)}</div>
            <div className={cn(subtle, 'truncate')}>
              {l.member_uid} · {l.method}
              {l.distance > 0 && ` · ${l.distance.toFixed(2)} m`}
            </div>
          </button>
        </li>
      ))}
      {links.length > 300 && (
        <li className={cn(subtle, 'px-2 py-1')}>Showing 300 of {links.length}.</li>
      )}
    </ul>
  );
}

function NameList({
  items,
  onPick,
}: {
  items: { key: string; label: string; hint?: string }[];
  onPick: (key: string) => void;
}) {
  if (items.length === 0) return <p className={cn(subtle, 'mt-1')}>None.</p>;
  return (
    <ul className="mt-1 max-h-48 overflow-auto rounded border border-edge">
      {items.slice(0, 300).map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="w-full truncate px-2 py-1 text-left hover:bg-surface-2"
            onClick={() => onPick(item.key)}
            title={item.hint ?? item.key}
          >
            {item.label}
          </button>
        </li>
      ))}
      {items.length > 300 && (
        <li className={cn(subtle, 'px-2 py-1')}>Showing 300 of {items.length}.</li>
      )}
    </ul>
  );
}

function MemberSection() {
  const shown = useAnalysis((s) => s.shown)!;
  const selectedMember = useAnalysis((s) => s.selectedMember);
  const selectMember = useAnalysis((s) => s.selectMember);
  const linkSet = useAnalysis((s) => s.linkSet);
  const [query, setQuery] = useState('');
  const m = shown.model;
  const member = selectedMember ? m.members.find((x) => x.uid === selectedMember) : undefined;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return m.members
      .filter(
        (x) =>
          x.uid.toLowerCase().includes(needle) ||
          x.name.toLowerCase().includes(needle) ||
          (x.section ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 50);
  }, [m.members, query]);

  const section = member?.section ? m.sections.find((s) => s.name === member.section) : undefined;
  const start = member ? m.nodes.find((n) => n.name === member.start) : undefined;
  const end = member ? m.nodes.find((n) => n.name === member.end) : undefined;
  const length =
    start && end ? Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) : undefined;
  const loads = member ? m.line_loads.filter((l) => l.member === member.uid) : [];
  const results = member ? m.results.filter((r) => r.member === member.uid) : [];
  const link = member ? linkSet?.report.links.find((l) => l.member_uid === member.uid) : undefined;

  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-fg-muted">Member</span>
        {member && (
          <button type="button" className={subtle} onClick={() => selectMember(null)}>
            clear
          </button>
        )}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a member by name or section…"
        aria-label="Find member"
        className={cn(field, 'placeholder:text-fg-muted')}
      />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-auto rounded border border-edge">
          {matches.map((x) => (
            <li key={x.uid}>
              <button
                type="button"
                className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-surface-2"
                onClick={() => {
                  selectMember(x.uid, true);
                  setQuery('');
                }}
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: MEMBER_KIND_COLORS[x.kind] }}
                />
                <span className="truncate">{x.uid}</span>
                <span className={cn(subtle, 'ml-auto truncate')}>{x.section ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!member ? (
        <p className={cn(subtle, 'mt-1')}>Click a member in the viewport to see it here.</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center gap-1 text-sm font-semibold">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ background: MEMBER_KIND_COLORS[member.kind] }}
            />
            {member.uid}
          </div>
          <Row label="Kind" value={member.kind} />
          <Row
            label="Section"
            value={
              section
                ? `${section.name}${section.shape ? ` (${section.shape})` : ''}${
                    section.dimensions.length
                      ? ` ${section.dimensions.map((d) => `${d.name}=${d.value}`).join(' ')}`
                      : ''
                  }`
                : (member.section ?? '—')
            }
          />
          <Row label="Material" value={member.material ?? section?.material ?? '—'} />
          {member.storey && <Row label="Storey" value={member.storey} />}
          <Row
            label="From"
            value={
              start
                ? `${member.start} (${fmt(start.x)}, ${fmt(start.y)}, ${fmt(start.z)})`
                : member.start
            }
          />
          <Row
            label="To"
            value={end ? `${member.end} (${fmt(end.x)}, ${fmt(end.y)}, ${fmt(end.z)})` : member.end}
          />
          {length !== undefined && (
            <Row label="Length" value={`${fmt(length)} ${m.units.length}`} />
          )}
          <Row
            label="Linked to"
            value={link ? `${link.physical_section ?? link.global_id} (${link.method})` : 'nothing'}
          />
          {loads.length > 0 && (
            <div>
              <div className={cn(subtle, 'mt-1')}>
                Line loads ({m.units.force}/{m.units.length})
              </div>
              <ul className="font-mono text-[11px]">
                {loads.map((l, i) => (
                  <li key={i}>
                    {l.case}: {l.start === l.end ? fmt(l.start) : `${fmt(l.start)} → ${fmt(l.end)}`}{' '}
                    {l.direction}
                    {(l.from > 0 || l.to < 1) && ` on ${fmt(l.from)}…${fmt(l.to)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {results.length > 0 && <Results results={results} units={m.units} />}
        </div>
      )}
    </div>
  );
}

function Results({
  results,
  units,
}: {
  results: MemberForce[];
  units: { force: string; length: string };
}) {
  const cases = useMemo(() => [...new Set(results.map((r) => r.case))], [results]);
  const [selectedCase, setSelectedCase] = useState(cases[0] ?? '');
  const [component, setComponent] =
    useState<keyof Pick<MemberForce, 'n' | 'vy' | 'vz' | 't' | 'my' | 'mz'>>('mz');
  useEffect(() => {
    if (!cases.includes(selectedCase)) setSelectedCase(cases[0] ?? '');
  }, [cases, selectedCase]);
  const rows = results.filter((r) => r.case === selectedCase).sort((a, b) => a.station - b.station);
  const extremes = (key: typeof component) => {
    const values = rows.map((r) => r[key]);
    return values.length ? `${fmt(Math.min(...values))} / ${fmt(Math.max(...values))}` : '—';
  };
  const momentUnit = `${units.force}·${units.length}`;
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <span className={subtle}>Results</span>
        <select
          className={cn(field, 'w-auto flex-1')}
          value={selectedCase}
          onChange={(e) => setSelectedCase(e.target.value)}
        >
          {cases.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          className={cn(field, 'w-auto')}
          value={component}
          onChange={(e) => setComponent(e.target.value as typeof component)}
          aria-label="Force component"
        >
          {(['n', 'vy', 'vz', 't', 'my', 'mz'] as const).map((c) => (
            <option key={c} value={c}>
              {c.toUpperCase()}
            </option>
          ))}
        </select>
      </div>
      <ForceDiagram rows={rows} component={component} />
      <table className="mt-1 w-full font-mono text-[10px]">
        <tbody>
          {(
            [
              ['N', 'n', units.force],
              ['Vy', 'vy', units.force],
              ['Vz', 'vz', units.force],
              ['T', 't', momentUnit],
              ['My', 'my', momentUnit],
              ['Mz', 'mz', momentUnit],
            ] as const
          ).map(([label, key, unit]) => (
            <tr key={key} className={cn(key === component && 'text-fg')}>
              <td className="text-fg-muted">{label}</td>
              <td className="text-right">{extremes(key)}</td>
              <td className="pl-1 text-fg-muted">{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CasesSection({ model }: { model: AnalysisModel }) {
  const [open, setOpen] = useState(false);
  if (model.load_cases.length === 0 && model.combinations.length === 0) return null;
  return (
    <div className="border-b border-edge px-3 py-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Load cases and combinations
      </button>
      {open && (
        <div className="mt-1 space-y-1 text-[11px]">
          <ul>
            {model.load_cases.map((c) => (
              <li key={c.name} className="flex justify-between">
                <span>{c.name}</span>
                <span className="text-fg-muted">{c.kind}</span>
              </li>
            ))}
          </ul>
          {model.combinations.map((c) => (
            <div key={c.name}>
              <div className="font-semibold">
                {c.name} <span className="font-normal text-fg-muted">{c.kind}</span>
              </div>
              <div className="font-mono text-[10px] text-fg-muted">
                {c.factors.map((f) => `${f.factor} × ${f.case}`).join(' + ') || '—'}
              </div>
            </div>
          ))}
          {model.materials.length > 0 && (
            <div>
              <div className="font-semibold">Materials</div>
              <ul className="text-fg-muted">
                {model.materials.map((mat) => (
                  <li key={mat.name}>
                    {mat.name} · {mat.kind}
                    {mat.e_modulus ? ` · E ${mat.e_modulus.toLocaleString()}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-1 text-[11px]">
      <span className="text-fg-muted">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function fmt(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(Math.abs(value) >= 100 ? 1 : 3).replace(/\.?0+$/, '');
}
