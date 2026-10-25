import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@kingpost/ui';
import { App } from './App';
import { useAnalysis } from './state/analysis';
import { useAppearance } from './state/appearance';
import { useClash } from './state/clash';
import { useCompare } from './state/compare';
import { useDrawings } from './state/drawings';
import { useLicence } from './state/licence';
import { useUpdates } from './state/updates';
import { useModel } from './state/model';
import { useProject } from './state/project';
import { useReview } from './state/review';
import { useSchedules } from './state/schedules';
import { useUi } from './state/ui';
import { useView } from './state/view';
import { useViewer } from './state/viewer';
import { useViews } from './state/views';
import { useHistory } from './state/history';
import { useFederation } from './state/federation';
import { useMeasure } from './state/measure';
import { useNotes } from './state/notes';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing the #root element');

// Development builds expose the stores for scripted checks and debugging from the console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    kingpost: {
      useAnalysis,
      useAppearance,
      useClash,
      useCompare,
      useDrawings,
      useLicence,
      useUpdates,
      useModel,
      useProject,
      useReview,
      useSchedules,
      useUi,
      useView,
      useViewer,
      useViews,
      useHistory,
      useFederation,
      useMeasure,
      useNotes,
    },
  });
}

createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
