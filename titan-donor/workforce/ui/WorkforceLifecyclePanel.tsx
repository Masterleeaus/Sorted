import { Card } from '@/components/ui';
import type { WorkforceLifecycleInspectionView } from '@/lib/titan/workforce-lifecycle/inspection';

export function WorkforceLifecyclePanel({ agents }: { agents: readonly WorkforceLifecycleInspectionView[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Card padding="default">
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
          Lifecycle controls are request-only. They use the existing governed workforce authority path. Settings does not install, uninstall, execute, or grant permissions directly.
        </p>
      </Card>

      {agents.length === 0 ? (
        <Card padding="default">
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
            No lifecycle inspection records are available in this read-only projection yet.
          </p>
        </Card>
      ) : agents.map((agent) => (
        <Card key={agent.agent_key} padding="default">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{agent.agent_key}</h3>
              <p style={{ margin: '4px 0 0', color: 'var(--fg-muted)', fontSize: 'var(--text-xs)' }}>
                {agent.lifecycle_state} · {agent.health_state} · {agent.active_work_count} active
              </p>
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: agent.accepts_new_assignments ? 'var(--success)' : 'var(--fg-muted)' }}>
              {agent.accepts_new_assignments ? 'Assignment-ready' : 'Not assignment-ready'}
            </span>
          </div>

          {agent.status_reasons.length > 0 && (
            <ul style={{ margin: 'var(--space-3) 0 0', paddingLeft: 18, color: 'var(--fg-muted)', fontSize: 'var(--text-xs)' }}>
              {agent.status_reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            {agent.controls.map((control) => (
              <div key={control.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{control.label}</div>
                <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: control.available ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  {control.available ? 'Request available' : 'Blocked'}
                </div>
                <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{control.reason}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
