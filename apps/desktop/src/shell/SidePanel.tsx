import { useUi, type Section } from '../state/ui';
import { ExplorerPanel } from '../features/explorer/ExplorerPanel';
import { ViewerPanel } from '../features/viewer/ViewerPanel';
import { LabPanel } from '../features/lab/LabPanel';
import { PlannedPanel } from '../features/planned/PlannedPanel';

const planned: Partial<Record<Section, { phase: string; summary: string }>> = {
  review: {
    phase: 'Phase 2',
    summary:
      'BCF issues with viewpoints, a design-status pipeline for every element, and markups in 3D.',
  },
  compare: {
    phase: 'Phase 3',
    summary:
      'Import a new revision and see every added, removed and modified member, section or property.',
  },
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
