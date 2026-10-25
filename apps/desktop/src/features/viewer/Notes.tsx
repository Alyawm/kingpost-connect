import { useState } from 'react';
import { Eye, EyeOff, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { cn } from '@kingpost/ui';
import { useModel } from '../../state/model';
import { useNotes } from '../../state/notes';
import { useView } from '../../state/view';

/** The box where a new note is typed, next to the clicked point. */
export function NoteEditor() {
  const draft = useNotes((s) => s.draft);
  const save = useNotes((s) => s.save);
  const cancel = useNotes((s) => s.cancel);
  const [text, setText] = useState('');
  if (!draft) return null;
  const submit = () => {
    void save(text).then(() => setText(''));
  };
  return (
    <div
      className="absolute z-20 w-64 rounded-md border border-edge bg-surface p-2 shadow-xl"
      style={{ left: draft.screen.x + 12, top: draft.screen.y + 12 }}
    >
      <div className="mb-1 flex items-center gap-1 text-[11px] text-fg-muted">
        <StickyNote size={12} /> New note
        {draft.globalId && <span className="truncate">· on the clicked element</span>}
      </div>
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder="Type the note — Enter saves, Shift+Enter for a new line, Esc cancels"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            setText('');
            cancel();
          }
        }}
        className="w-full resize-none rounded border border-edge bg-canvas p-1.5 text-xs outline-none focus:border-accent"
      />
      <div className="mt-1 flex justify-end gap-1">
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-2"
          onClick={() => {
            setText('');
            cancel();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!text.trim()}
          className="rounded bg-accent px-2 py-0.5 text-[11px] text-accent-fg disabled:opacity-50"
          onClick={submit}
        >
          Save note
        </button>
      </div>
    </div>
  );
}

/** Notes of the project: numbered as in the view; click to look at one. */
export function NotesSection() {
  const notes = useNotes((s) => s.notes);
  const visible = useNotes((s) => s.visible);
  const setVisible = useNotes((s) => s.setVisible);
  const focus = useNotes((s) => s.focus);
  const update = useNotes((s) => s.update);
  const remove = useNotes((s) => s.remove);
  const setTool = useView((s) => s.setTool);
  const byGlobalId = useModel((s) => s.byGlobalId);
  const byId = useModel((s) => s.byId);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="border-b border-edge px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 font-semibold text-fg-muted">
          <StickyNote size={12} /> Notes
        </span>
        <div className="flex items-center gap-1">
          {notes.length > 0 && (
            <button
              type="button"
              className="rounded p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              title={visible ? 'Hide notes in the view' : 'Show notes in the view'}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          )}
          <button
            type="button"
            className="text-[11px] text-fg-muted underline hover:text-fg"
            onClick={() => setTool('note')}
          >
            Add…
          </button>
        </div>
      </div>
      {notes.length === 0 ? (
        <p className="text-[10px] text-fg-muted">
          Pin notes to the model with the note tool; they stay with the project.
        </p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-auto">
          {notes.map((note, index) => {
            const id = note.global_id ? byGlobalId.get(note.global_id) : undefined;
            const element = id !== undefined ? byId.get(id) : undefined;
            return (
              <li
                key={note.id}
                className="group flex items-start gap-1 rounded px-1 py-0.5 hover:bg-surface-2"
              >
                <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10px] text-fg-muted">
                  {index + 1}
                </span>
                {editing === note.id ? (
                  <input
                    autoFocus
                    defaultValue={note.text}
                    aria-label="Note text"
                    className="h-6 min-w-0 flex-1 rounded border border-accent bg-canvas px-1 text-xs outline-none"
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== note.text) {
                        void update(note.id, e.target.value);
                      }
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title="Look at this note"
                    onClick={() => focus(note.id)}
                  >
                    <div className={cn('break-words', !visible && 'text-fg-muted')}>
                      {note.text}
                    </div>
                    <div className="truncate text-[10px] text-fg-muted">
                      {[
                        note.author,
                        element?.name ?? element?.ifc_type,
                        note.created_at.slice(0, 10),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </button>
                )}
                <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    aria-label="Edit note"
                    className="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
                    onClick={() => setEditing(note.id)}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete note"
                    className="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-danger"
                    onClick={() => void remove(note.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
