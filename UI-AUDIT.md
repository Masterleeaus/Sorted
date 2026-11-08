# Titan Go Field — v3 UI audit

## Highest-impact problems found

1. **The product boundary was still visually unclear.** The old shell exposed Desk/Pay concepts in Field navigation and utility hubs.
2. **Mobile landing contradicted the product concept.** Owners on phones were being sent to Today instead of the conversational Titan Zero Command surface.
3. **Workforce exposed repository architecture rather than product architecture.** Long lists and internal agent terminology obscured the Manager → Specialist → Worker model.
4. **The Field runtime filter was incomplete.** The page claimed to show Field runtime only while lifecycle data could still include non-Field workforce.
5. **Work Orders had a top-level nav link but its list route simply redirected to Jobs.** This made the information architecture misleading.
6. **Operations Analytics pointed into old financial/reporting concepts rather than a Field-specific view.**
7. **Settings still mixed product configuration with old cross-product assumptions.**
8. **House / Vehicle tracking / Desk terminology survived in primary Field surfaces.**
9. **The shell had a malformed duplicate closing `aside` introduced during iterative redesign.** Fixed in v3 and syntax-validated.
10. **The global command-palette event still used a Dovetails internal event name.** Renamed to the Titan event seam.

## Design rules now enforced

- Titan Go = one PWA.
- Field = active mode.
- Titan Zero = conversational command layer.
- Navigation = inspection/manual control layer.
- `+ New` = explicit object creation.
- One Operations Manager in the default Field workforce.
- Five portfolios are organisational groupings, not management tiers.
- Customer-facing workforce terms are only Manager, Lead Specialist, Specialist and Worker.
- Field navigation does not become a second Desk or Pay.
- Gold is product identity, not warning state.
- Mobile owner Command is conversation-first; desktop/iPad is command-centre-first.
- Standards is included in Field and remains visible as a first-class operating surface.
