import { create } from 'zustand';
import { useModel } from './model';
import { useViewer } from './viewer';

/** A user's override for one element: a CSS colour, an opacity from 0 to 1, or both. */
export interface Look {
  color?: string;
  opacity?: number;
}

/** Opacity given to everything else by "ghost others". */
export const GHOST_OPACITY = 0.12;

/** What a set of elements has in common, for swatches and sliders. */
export interface CommonLook {
  /** The shared colour, null when none is overridden, 'mixed' when they differ. */
  color: string | null | 'mixed';
  /** The shared opacity (1 when none is set), or 'mixed'. */
  opacity: number | 'mixed';
}

interface AppearanceState {
  /** Express id → override. Session state of the loaded revision; saved views keep copies. */
  looks: Map<number, Look>;
  setColor(ids: Iterable<number>, color: string | null): void;
  setOpacity(ids: Iterable<number>, opacity: number | null): void;
  /** Removes the overrides of the given elements, or of every element. */
  reset(ids?: Iterable<number>): void;
  /** Makes every other element nearly transparent so the given ones stand out. */
  ghostOthers(ids: Iterable<number>): void;
  /** Replaces all overrides at once (used when a saved view is applied). */
  replace(looks: Map<number, Look>): void;
}

function clean(look: Look): Look | null {
  const out: Look = {};
  if (look.color) out.color = look.color;
  if (typeof look.opacity === 'number' && look.opacity < 1) {
    out.opacity = Math.max(0, Math.round(look.opacity * 100) / 100);
  }
  return out.color === undefined && out.opacity === undefined ? null : out;
}

function apply(looks: Map<number, Look>): void {
  useModel.getState().model?.setAppearance(looks);
  useViewer.getState().handle?.render();
}

export const useAppearance = create<AppearanceState>((set, get) => {
  const update = (ids: Iterable<number>, patch: (look: Look) => Look) => {
    const looks = new Map(get().looks);
    for (const id of ids) {
      const next = clean(patch(looks.get(id) ?? {}));
      if (next) looks.set(id, next);
      else looks.delete(id);
    }
    apply(looks);
    set({ looks });
  };

  return {
    looks: new Map(),

    setColor: (ids, color) =>
      update(ids, (look) => {
        const next = { ...look };
        if (color) next.color = color;
        else delete next.color;
        return next;
      }),

    setOpacity: (ids, opacity) =>
      update(ids, (look) => {
        const next = { ...look };
        if (opacity === null || opacity >= 1) delete next.opacity;
        else next.opacity = opacity;
        return next;
      }),

    reset: (ids) => {
      if (!ids) {
        apply(new Map());
        set({ looks: new Map() });
        return;
      }
      update(ids, () => ({}));
    },

    ghostOthers: (ids) => {
      const keep = new Set(ids);
      const { elements } = useModel.getState();
      const others = elements
        .filter((e) => e.has_geometry && !e.is_spatial && !keep.has(e.express_id))
        .map((e) => e.express_id);
      const looks = new Map(get().looks);
      for (const id of keep) {
        const look = looks.get(id);
        if (look?.opacity !== undefined) {
          const next = clean({ ...look, opacity: 1 });
          if (next) looks.set(id, next);
          else looks.delete(id);
        }
      }
      for (const id of others) {
        looks.set(id, { ...looks.get(id), opacity: GHOST_OPACITY });
      }
      apply(looks);
      set({ looks });
    },

    replace: (looks) => {
      const next = new Map<number, Look>();
      for (const [id, look] of looks) {
        const cleaned = clean(look);
        if (cleaned) next.set(id, cleaned);
      }
      apply(next);
      set({ looks: next });
    },
  };
});

/** The colour and opacity a group of elements shares. */
export function commonLook(looks: ReadonlyMap<number, Look>, ids: readonly number[]): CommonLook {
  let color: CommonLook['color'] | undefined;
  let opacity: CommonLook['opacity'] | undefined;
  for (const id of ids) {
    const look = looks.get(id);
    const c = look?.color ?? null;
    const o = look?.opacity ?? 1;
    color = color === undefined ? c : color === c ? color : 'mixed';
    opacity = opacity === undefined ? o : opacity === o ? opacity : 'mixed';
    if (color === 'mixed' && opacity === 'mixed') break;
  }
  return { color: color ?? null, opacity: opacity ?? 1 };
}

/** True when any of the elements carries an override. */
export function hasLook(looks: ReadonlyMap<number, Look>, ids: readonly number[]): boolean {
  return ids.some((id) => looks.has(id));
}

// A new or cleared model starts with no overrides.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) useAppearance.setState({ looks: new Map() });
});
