import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RoleChat } from '../role-chat';
import { RoleInbox } from '../role-secondary-surfaces';
import { GoNext } from '../role-details';

vi.stubGlobal('React', React);

describe('canonical role surface primitives', () => {
  it.each(['zero', 'go', 'hub'] as const)('renders %s chat with its labelled canonical textarea', (role) => {
    const html = renderToStaticMarkup(React.createElement(RoleChat, { role, onOpenDetails() {} }));
    expect(html).toContain(`id="titan-${role}-message"`);
    expect(html).toContain('p7-textarea');
    expect(html).toContain('Actions are receipt-controlled');
    expect(html).toContain('aria-label="Send"');
  });

  it('keeps field conversation controls on styled primitives with an accessible composer', () => {
    const html = renderToStaticMarkup(React.createElement(RoleInbox, { role: 'go', command: null }));
    expect(html).toContain('p7-btn-secondary');
    expect(html).toContain('aria-label="Message dispatch"');
    expect(html).toContain('aria-label="Call"');
    expect(html).not.toContain('p7-btn-outline');
    expect(html).not.toContain('p7-btn-icon');
  });

  it('renders Go actions without changing receipt-controlled completion', () => {
    const html = renderToStaticMarkup(React.createElement(GoNext));
    expect(html).toContain('State changes require a matching Titan receipt');
    expect(html).toContain('p7-btn-secondary');
    expect(html).toContain('Evidence 0 of 2');
  });
});
