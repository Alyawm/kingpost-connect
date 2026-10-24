import {
  Activity,
  Box,
  ClipboardCheck,
  FileText,
  FlaskConical,
  FolderOpen,
  GitCompareArrows,
  type LucideIcon,
} from 'lucide-react';
import { IconButton } from '@kingpost/ui';
import { useUi, type Section } from '../state/ui';
import { sectionTitles } from './commands';

const items: { section: Section; icon: LucideIcon }[] = [
  { section: 'explorer', icon: FolderOpen },
  { section: 'viewer', icon: Box },
  { section: 'review', icon: ClipboardCheck },
  { section: 'compare', icon: GitCompareArrows },
  { section: 'analysis', icon: Activity },
  { section: 'drawings', icon: FileText },
];

export function Rail() {
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);

  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-edge bg-surface py-2"
      aria-label="Sections"
    >
      {items.map(({ section: id, icon: Icon }) => (
        <IconButton
          key={id}
          label={sectionTitles[id]}
          active={section === id}
          onClick={() => setSection(id)}
        >
          <Icon size={18} strokeWidth={1.75} />
        </IconButton>
      ))}
      <div className="flex-1" />
      <IconButton
        label={sectionTitles.lab}
        active={section === 'lab'}
        onClick={() => setSection('lab')}
      >
        <FlaskConical size={18} strokeWidth={1.75} />
      </IconButton>
    </nav>
  );
}
