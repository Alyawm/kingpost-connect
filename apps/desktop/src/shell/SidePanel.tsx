import { useUi } from '../state/ui';
import { ExplorerPanel } from '../features/explorer/ExplorerPanel';
import { ViewerPanel } from '../features/viewer/ViewerPanel';
import { LabPanel } from '../features/lab/LabPanel';
import { ReviewPanel } from '../features/review/ReviewPanel';
import { ComparePanel } from '../features/compare/ComparePanel';
import { AnalysisPanel } from '../features/analysis/AnalysisPanel';
import { DrawingsPanel } from '../features/drawings/DrawingsPanel';

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
    case 'analysis':
      return <AnalysisPanel />;
    case 'drawings':
      return <DrawingsPanel />;
    case 'lab':
      return <LabPanel />;
  }
}
