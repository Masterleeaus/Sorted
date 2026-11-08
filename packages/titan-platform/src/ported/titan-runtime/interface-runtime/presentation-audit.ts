// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interface-runtime/presentation-audit.mjs
const INTERACTIVE = new Set(['button','link','input','select','textarea','checkbox','radio','switch','menuitem','tab','action']);
const MOBILE_FIRST = new Set(['go','hub','onboarding']);

export function auditPresentationAccessibility(tree = {}) {
  const violations = [];
  const seen = new Set();
  let nodes_checked = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    nodes_checked += 1;
    const key = String(node.key ?? '');
    if (seen.has(key)) violations.push({ code:'duplicate-key', key, message:'Presentation keys must be unique for deterministic focus and labelling.' });
    seen.add(key);
    const props = node.props && typeof node.props === 'object' ? node.props : {};
    const a11y = props.accessibility && typeof props.accessibility === 'object' ? props.accessibility : {};
    const interactive = INTERACTIVE.has(String(node.type ?? '').toLowerCase()) || props.interactive === true;
    if (interactive) {
      const name = String(a11y.name ?? props.accessible_name ?? '').trim();
      if (!name) violations.push({ code:'accessible-name', key, message:'Interactive presentation requires an accessible name.' });
      if (a11y.keyboard_operable !== true) violations.push({ code:'keyboard', key, message:'Interactive presentation must be keyboard operable.' });
      if (a11y.focus_visible !== true) violations.push({ code:'focus-visible', key, message:'Interactive presentation must expose visible focus.' });
      if (Number(a11y.target_size_px ?? 0) < 24) violations.push({ code:'target-size', key, message:'Interactive target must meet the 24 CSS px minimum target-size check.' });
      if (Number.isFinite(Number(a11y.tab_index)) && Number(a11y.tab_index) > 0) violations.push({ code:'tab-order', key, message:'Positive tabindex is prohibited; DOM order owns focus order.' });
    }
    if (a11y.live_region != null && !['off','polite','assertive'].includes(a11y.live_region)) {
      violations.push({ code:'live-region', key, message:'Live region must be off, polite or assertive.' });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child);
  };
  walk(tree.root);
  return Object.freeze({ schema:'titan.presentation-accessibility-audit.v1', nodes_checked, pass:violations.length === 0, violations:Object.freeze(violations) });
}

export function auditResponsivePresentation(tree = {}) {
  const violations = [];
  const surface = String(tree.surface ?? '');
  const responsive = tree.responsive && typeof tree.responsive === 'object' ? tree.responsive : {};
  if (MOBILE_FIRST.has(surface) && responsive.mode === 'fixed') violations.push('Mobile-first surfaces cannot use fixed-only responsive mode.');
  for (const [name, px] of Object.entries(responsive.breakpoints ?? {})) {
    const value = Number(px);
    if (!Number.isFinite(value) || value < 240 || value > 4096) violations.push(`Breakpoint ${name} is outside supported bounds.`);
  }
  return Object.freeze({ schema:'titan.presentation-responsive-audit.v1', pass:violations.length === 0, violations:Object.freeze(violations) });
}
