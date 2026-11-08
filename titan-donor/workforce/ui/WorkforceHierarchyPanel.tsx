import { Card } from '@/components/ui';
import type { WorkforceHierarchyInspection } from './workforce-hierarchy-data';

const TIER_LABEL = {
  manager: 'Manager',
  supervisor: 'Supervisor',
  agent: 'Agent',
  worker: 'Worker',
} as const;

export function WorkforceHierarchyPanel({ inspection }: { inspection: WorkforceHierarchyInspection }) {
  const childrenByParent = new Map<string, typeof inspection.rows>();
  for (const row of inspection.rows) {
    if (!row.parentId) continue;
    const current = childrenByParent.get(row.parentId) ?? [];
    childrenByParent.set(row.parentId, [...current, row]);
  }

  const roots = inspection.rows.filter((row) => row.tier === 'manager');

  const renderBranch = (row: (typeof inspection.rows)[number], depth = 0): React.ReactNode => {
    const children = childrenByParent.get(row.id) ?? [];
    return (
      <div key={`${row.tier}:${row.id}`} style={{ marginLeft: depth ? 'var(--space-4)' : 0 }}>
        <div style={{
          borderLeft: depth ? '2px solid var(--border)' : undefined,
          paddingLeft: depth ? 'var(--space-3)' : 0,
          paddingTop: 'var(--space-2)',
          paddingBottom: 'var(--space-2)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'baseline' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{row.label}</span>
              <span style={{ marginLeft: 8, color: 'var(--fg-muted)', fontSize: 'var(--text-xs)' }}>{TIER_LABEL[row.tier]}</span>
            </div>
            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-xs)' }}>{row.domain ?? 'company'}</span>
          </div>
          <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
            {row.id} · no execution authority from hierarchy
          </div>
        </div>
        {children.map((child) => renderBranch(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Card padding="default">
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
          Read-only organisational inspection. Manager, Supervisor, Agent and Worker identity does not grant execution authority. Commands still require the existing authority evaluation and capability-resolution path.
        </p>
      </Card>

      <Card padding="default">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-3)' }}>
          {Object.entries(inspection.counts).map(([key, value]) => (
            <div key={key}>
              <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-xs)', textTransform: 'capitalize' }}>{key}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </Card>

      {roots.length === 0 ? (
        <Card padding="default">
          <p style={{ margin: 0, color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>
            No hierarchy catalogue records are available for this company projection yet.
          </p>
        </Card>
      ) : (
        <Card padding="default">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {roots.map((root) => renderBranch(root))}
          </div>
        </Card>
      )}

      <Card padding="default">
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
          Source: canonical workforce organisational graph · read-only: yes · execution permitted: no · grants authority: no
        </div>
      </Card>
    </div>
  );
}
