import { useUi, type Section } from '../state/ui';
import { ExplorerPanel } from '../features/explorer/ExplorerPanel';
import { ViewerPanel } from '../features/viewer/ViewerPanel';
import { LabPanel } from '../features/lab/LabPanel';
import { PlannedPanel } from '../features/planned/PlannedPanel';
import { ReviewPanel } from '../features/review/ReviewPanel';
import { ComparePanel } from '../features/compare/ComparePanel';

const planned: Partial<Record<Section, { phase: string; summary: string }>> = {
  analysis: {
    phase: 'Phase 4',
    summary:
      'Overlay SAF, IFC structural and ETABS/SAP2000 models on the physical model and report mismatches.',
  },
  drawings: {
    phase: 'Phase 5',
    summary: 'PDF sheets linked to elements and views, markups, and sheet revision comparison.',
  },
};

export function SidePanel() {
  const section = useUi((s) => s.section);
  switch (section) {
    case 'explorer':
      return <ExplorerPanel />;
    case 'viewer':
      return <ViewerPanel />;
    case 'review':
      return <ReviewPanel />;
    case 'compare':
      return <ComparePanel />;
    case 'lab':
      return <LabPanel />;
    default: {
      const info = planned[section];
      return (
        <PlannedPanel section={section} phase={info?.phase ?? ''} summary={info?.summary ?? ''} />
      );
    }
  }
}
