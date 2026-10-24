import { Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import type { Section } from '../../state/ui';
import { sectionTitles } from '../../shell/commands';

/** Placeholder for sections whose phase has not started; keeps the roadmap visible in-app. */
export function PlannedPanel({
  section,
  phase,
  summary,
}: {
  section: Section;
  phase: string;
  summary: string;
}) {
  return (
    <Panel>
      <PanelHeader title={sectionTitles[section]} />
      <PanelBody className="space-y-2">
        <div className="inline-block rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
          {phase}
        </div>
        <p className="text-xs text-fg-muted">{summary}</p>
      </PanelBody>
    </Panel>
  );
}
