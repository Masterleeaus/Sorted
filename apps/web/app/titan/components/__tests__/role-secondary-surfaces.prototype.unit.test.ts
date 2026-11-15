import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RoleInbox, RoleMore } from '../role-secondary-surfaces';

vi.stubGlobal('React', React);

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const FORBIDDEN_CLAIMS = [
  /dispatch connected/i,
  /\bsynced\b/i,
  /evidence ready/i,
  /\blive\b/i,
  /is online/i,
  /under 5 minutes/i,
  /\bverified\b/i,
  /\bprotected\b/i,
  /available offline/i,
  /receives the job context/i,
];

describe('role secondary surfaces are labelled prototypes', () => {
  const renders = {
    'Go inbox': () => renderToStaticMarkup(React.createElement(RoleInbox, { role: 'go', command: null })),
    'Hub inbox': () => renderToStaticMarkup(React.createElement(RoleInbox, { role: 'hub', command: null })),
    'Go more': () => renderToStaticMarkup(React.createElement(RoleMore, { role: 'go', command: null })),
    'Hub more': () => renderToStaticMarkup(React.createElement(RoleMore, { role: 'hub', command: null })),
  };

  it.each(Object.keys(renders))('%s shows the visible prototype label', (name) => {
    const html = renders[name as keyof typeof renders]();
    expect(html).toContain('Prototype — sample data');
  });

  it.each(Object.keys(renders))('%s contains no unsupported live, sync or connection claims', (name) => {
    const plain = text(renders[name as keyof typeof renders]());
    for (const pattern of FORBIDDEN_CLAIMS) {
      expect(plain, `${name} matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it('keeps the accessible dispatch composer and call control', () => {
    const html = renders['Go inbox']();
    expect(html).toContain('aria-label="Message dispatch"');
    expect(html).toContain('aria-label="Call"');
  });
});
