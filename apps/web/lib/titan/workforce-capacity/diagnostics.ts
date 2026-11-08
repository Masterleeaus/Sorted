import { buildWorkforceCapacityDiagnostics, type WorkforceDiagnosticsInput } from '@titan-zero/titan-platform/workforce-capacity';

/**
 * Read-only adapter for Titan Zero operational inspection surfaces.
 * UI consumers render this projection inside the existing diagnostics/control-room patterns;
 * they do not receive mutation commands or authority from this adapter.
 */
export function buildWorkforceCapacityInspectionView(input: WorkforceDiagnosticsInput) {
  const projection = buildWorkforceCapacityDiagnostics(input);
  return {
    title: input.viewer.role === 'manager' ? 'Workforce Capacity & Quality' : 'Team Capacity & Quality',
    badges: [
      { key: 'critical', label: 'Critical', value: projection.summary.critical_alerts },
      { key: 'warning', label: 'Warning', value: projection.summary.warning_alerts },
      { key: 'queue', label: 'Queue', value: projection.summary.capacity.queue_depth },
      { key: 'sla', label: 'SLA Breaches', value: projection.summary.sla.breached },
    ],
    sections: [
      { key: 'alerts', title: 'Attention', rows: projection.sections.alerts },
      { key: 'capacity', title: 'Capacity', rows: projection.sections.capacity },
      { key: 'sla', title: 'SLA & Deadlines', rows: projection.sections.sla },
      { key: 'quality', title: 'Quality Outcomes', rows: projection.sections.quality },
      { key: 'backpressure', title: 'Intake Pressure', rows: projection.sections.backpressure },
      { key: 'feedback', title: 'Routing Feedback', rows: projection.sections.feedback },
    ],
    projection,
    readOnly: true,
    mutationActions: [],
  } as const;
}
