// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-settings-integrated.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero integrated settings controls — unique Titan controls hosted by the rich Settings page. */
(() => {
  'use strict';

  const openPanel = async (view) => {
    await chrome.storage.local.set({ titanZeroView: view });
    const win = await chrome.windows.getCurrent();
    try {
      await chrome.sidePanel.open({ windowId: win.id });
    } catch (_) {
      const base = chrome.runtime.getURL('sidePanel.html');
      const query = new URLSearchParams({ view: String(view || 'chat'), fullscreen: '1' });
      await chrome.tabs.create({ url: `${base}?${query.toString()}` });
    }
  };

  const launch = async (action) => {
    if (action === 'chat') {
      await chrome.storage.local.set({ titanAiWorkspaceTarget: 'Chat' });
      return openPanel('ai');
    }
    if (action === 'work') return openPanel('agent');
    if (action === 'diagnostics') {
      return chrome.tabs.create({ url: chrome.runtime.getURL('diagnostics.html') });
    }
  };

  document.querySelectorAll('[data-titan-settings-launch]').forEach((button) => {
    button.addEventListener('click', () => launch(button.dataset.titanSettingsLaunch));
  });

  document.documentElement.setAttribute('data-titan-settings-native-controls', 'integrated');
})();
