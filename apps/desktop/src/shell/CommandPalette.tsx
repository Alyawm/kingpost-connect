import { useMemo } from 'react';
import { Command } from 'cmdk';
import { Kbd } from '@kingpost/ui';
import { useUi } from '../state/ui';
import { useProject } from '../state/project';
import { listCommands } from './commands';

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  // Subscribed so the list refreshes when the commands it offers change.
  const theme = useUi((s) => s.theme);
  const project = useProject((s) => s.current);

  const groups = useMemo(() => {
    const byGroup = new Map<string, ReturnType<typeof listCommands>>();
    for (const command of listCommands()) {
      byGroup.set(command.group, [...(byGroup.get(command.group) ?? []), command]);
    }
    return [...byGroup.entries()];
    // theme and project are read inside listCommands through the stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, theme, project]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed left-1/2 top-24 z-50 w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-edge bg-surface shadow-2xl"
      overlayClassName="fixed inset-0 z-40 bg-black/40"
    >
      <Command.Input
        autoFocus
        placeholder="Type a command…"
        className="h-11 w-full border-b border-edge bg-transparent px-4 text-sm outline-none placeholder:text-fg-muted"
      />
      <Command.List className="max-h-80 overflow-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-xs text-fg-muted">
          No matching command.
        </Command.Empty>
        {groups.map(([group, commands]) => (
          <Command.Group
            key={group}
            heading={group}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-muted"
          >
            {commands.map((command) => (
              <Command.Item
                key={command.id}
                value={command.title}
                onSelect={() => {
                  setOpen(false);
                  command.run();
                }}
                className="flex cursor-default items-center justify-between rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-surface-3"
              >
                <span>{command.title}</span>
                {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
