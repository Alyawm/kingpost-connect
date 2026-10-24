import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@kingpost/ui';
import { App } from './App';
import { useAnalysis } from './state/analysis';
import { useClash } from './state/clash';
import { useCompare } from './state/compare';
import { useDrawings } from './state/drawings';
import { useLicence } from './state/licence';
import { useUpdates } from './state/updates';
import { useModel } from './state/model';
import { useProject } from './state/project';
import { useReview } from './state/review';
import { useUi } from './state/ui';
import { useView } from './state/view';
import { useViewer } from './state/viewer';
import { useViews } from './state/views';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing the #root element');

// Development builds expose the stores for scripted checks and debugging from the console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    kingpost: {
      useAnalysis,
      useClash,
      useCompare,
      useDrawings,
      useLicence,
      useUpdates,
      useModel,
      useProject,
      useReview,
      useUi,
      useView,
      useViewer,
      useViews,
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
