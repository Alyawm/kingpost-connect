import { useMemo, type ReactNode } from 'react';
import { Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import { useViewer } from '../state/viewer';
import { useModel } from '../state/model';
import { formatQuantity } from '../lib/format';
import type { PropertyOut } from '../lib/ipc';

export function Inspector() {
  const pick = useViewer((s) => s.selection);
  const selectedId = useModel((s) => s.selectedId);
  const summary = useModel((s) => (selectedId === null ? null : (s.byId.get(selectedId) ?? null)));
  const details = useModel((s) => s.details);

  const psets = useMemo(() => groupBySet(details?.properties ?? []), [details]);

  return (
    <Panel>
      <PanelHeader title="Properties" />
      <PanelBody className="p-0">
        {selectedId !== null ? (
          <div>
            <div className="border-b border-edge px-3 py-2">
              <div className="text-sm font-semibold">
                {summary?.name || summary?.tag || `#${selectedId}`}
              </div>
              <div className="font-mono text-[11px] text-fg-muted">
                {summary?.ifc_type ?? 'IfcProduct'} · #{selectedId}
              </div>
            </div>
            <Section title="Element">
              <Field label="Name" value={summary?.name} />
              <Field label="Tag" value={summary?.tag} />
              <Field label="Type" value={summary?.type_name} />
              <Field label="Material" value={summary?.material} />
              <Field label="Storey" value={summary?.storey} />
              <Field label="GlobalId" value={summary?.global_id} mono />
            </Section>
            {psets.map(([pset, properties]) => (
              <Section key={pset} title={pset}>
                {properties.map((property) => (
                  <Field
                    key={property.name}
                    label={property.name}
                    value={formatValue(property)}
                    mono={property.kind !== 'text'}
                  />
                ))}
              </Section>
            ))}
            {details && psets.length === 0 && (
              <p className="px-3 py-2 text-xs text-fg-muted">No property sets on this element.</p>
            )}
          </div>
        ) : pick ? (
          <Section title="Selection">
            <Field label="Name" value={pick.name} />
            <Field label="Type" value={pick.type} mono />
          </Section>
        ) : (
          <p className="p-3 text-xs text-fg-muted">
            Click an element in the viewport or the model tree to see its properties.
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}

function groupBySet(properties: PropertyOut[]): [string, PropertyOut[]][] {
  const groups = new Map<string, PropertyOut[]>();
  for (const property of properties) {
    groups.set(property.pset, [...(groups.get(property.pset) ?? []), property]);
  }
  // Quantity sets after property sets, each alphabetical.
  return [...groups.entries()].sort(([a], [b]) => {
    const qa = a.startsWith('Qto_') ? 1 : 0;
    const qb = b.startsWith('Qto_') ? 1 : 0;
    return qa - qb || a.localeCompare(b);
  });
}

function formatValue(property: PropertyOut): string {
  if (property.value_num !== null && property.kind !== 'bool' && property.kind !== 'text') {
    return `${formatQuantity(property.value_num)}${property.unit ? ` ${property.unit}` : ''}`;
  }
  return property.value_text ?? (property.value_num !== null ? String(property.value_num) : '');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-edge px-3 py-2">
      <h3 className="mb-1 truncate text-[11px] font-semibold text-fg-muted" title={title}>
        {title}
      </h3>
      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-xs">
        {children}
      </dl>
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <>
      <dt className="truncate text-fg-muted" title={label}>
        {label}
      </dt>
      <dd className={mono ? 'break-all font-mono' : 'break-words'} title={value}>
        {value}
      </dd>
    </>
  );
}
