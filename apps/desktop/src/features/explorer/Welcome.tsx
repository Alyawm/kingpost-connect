import { Boxes, FolderOpen, X } from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { t } from '../../lib/i18n';
import { useModel } from '../../state/model';
import { useProject } from '../../state/project';
import { useReview } from '../../state/review';
import { useUi } from '../../state/ui';

/** Shown in the Explorer while no project is open. */
export function Welcome() {
  const busy = useProject((s) => s.busy);
  const openFolder = useProject((s) => s.openFolder);
  const openPath = useProject((s) => s.openPath);
  const openSample = useProject((s) => s.openSample);
  const recent = useUi((s) => s.recentProjects);
  const forget = useUi((s) => s.forgetProject);

  return (
    <div className="space-y-3 p-3 text-xs" data-testid="welcome">
      <div>
        <div className="text-sm font-semibold">{t('welcome.title')}</div>
        <p className="mt-1 text-fg-muted">{t('welcome.lead')}</p>
      </div>
      <Button variant="primary" onClick={() => void openFolder()} disabled={busy}>
        <FolderOpen size={14} />
        {t('welcome.open')}
      </Button>
      <Button onClick={() => void openSample()} disabled={busy}>
        <Boxes size={14} />
        {t('welcome.sample')}
      </Button>
      <div>
        <div className="mb-1 text-[11px] font-semibold text-fg-muted">{t('welcome.recent')}</div>
        {recent.length === 0 ? (
          <p className="text-[10px] text-fg-muted">{t('welcome.recent.none')}</p>
        ) : (
          <ul className="space-y-0.5">
            {recent.map((root) => (
              <li key={root} className="flex items-center gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left hover:bg-surface-2"
                  title={root}
                  disabled={busy}
                  onClick={() => void openPath(root)}
                >
                  <span className="font-semibold">{root.split(/[\\/]/).filter(Boolean).pop()}</span>
                  <span className="ml-1 font-mono text-[10px] text-fg-muted">{root}</span>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-surface-2"
                  title="Remove from the list"
                  onClick={() => forget(root)}
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-fg-muted">{t('welcome.samples')}</p>
    </div>
  );
}

/** A short checklist for a fresh project, ticked off as the work happens. */
export function GettingStarted() {
  const dismissed = useUi((s) => s.onboardingDismissed);
  const dismiss = useUi((s) => s.dismissOnboarding);
  const files = useProject((s) => s.files);
  const loaded = useModel((s) => s.model !== null);
  const issues = useReview((s) => s.issues.length);
  if (dismissed) return null;
  const imported = files.some((f) => f.revisions.length > 0);
  const compared = files.some((f) => f.revisions.length > 1);
  const steps: [string, boolean][] = [
    [t('onboarding.import'), imported],
    [t('onboarding.load'), loaded],
    [t('onboarding.review'), issues > 0],
    [t('onboarding.compare'), compared],
  ];
  return (
    <div className="border-b border-edge px-3 py-2 text-xs" data-testid="getting-started">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-fg-muted">{t('onboarding.title')}</span>
        <button type="button" className="text-[10px] text-fg-muted underline" onClick={dismiss}>
          {t('onboarding.dismiss')}
        </button>
      </div>
      <ol className="space-y-1">
        {steps.map(([text, done], i) => (
          <li
            key={i}
            className={cn('flex items-start gap-2', done && 'text-fg-muted line-through')}
          >
            <span
              className={cn(
                'mt-0.5 h-3 w-3 shrink-0 rounded-sm border',
                done ? 'border-accent bg-accent' : 'border-edge',
              )}
              aria-hidden
            />
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
