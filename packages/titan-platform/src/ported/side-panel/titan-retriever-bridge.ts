// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): side-panel/titan-retriever-bridge.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(() => {
  const STATE_KEY = 'titanRetrieverBridgeState';
  const EVENTS_KEY = 'titanRetrieverRuntimeEvents';
  const MAX_EVENTS = 250;
  let lastOutcome = '';
  let lastRequestId = '';
  let lastCompanyId = '';
  let lastWorker = null;
  let observer = null;
  let debounce = null;
  let lastText = '';
  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  console.error = (...args) => { originalConsoleError(...args); appendEvent({ level:'error', source:'retriever-console', type:'console.error', text:args.map(String).join(' ').slice(0,2000) }); };
  console.warn = (...args) => { originalConsoleWarn(...args); appendEvent({ level:'warn', source:'retriever-console', type:'console.warn', text:args.map(String).join(' ').slice(0,2000) }); };

  const saveState = async (state, detail = {}) => {
    try { await chrome.storage.local.set({ [STATE_KEY]: { state, at: Date.now(), ...detail } }); } catch (_) {}
  };
  const appendEvent = async (event) => {
    try {
      const data = await chrome.storage.local.get([EVENTS_KEY]);
      const list = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
      list.push({ at: Date.now(), ...event });
      await chrome.storage.local.set({ [EVENTS_KEY]: list.slice(-MAX_EVENTS) });
    } catch (_) {}
  };
  const emit = (type, payload = {}) => {
    try { window.parent.postMessage({ type, ...payload }, '*'); } catch (_) {}
  };
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 40 && r.height > 18 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const findComposer = () => {
    const candidates = [...document.querySelectorAll('textarea,[contenteditable="true"],input[type="text"],input:not([type])')].filter(visible);
    const score = (el) => {
      const hint = `${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-placeholder') || ''}`.toLowerCase();
      const rect = el.getBoundingClientRect();
      let points = rect.width / 100 + rect.top / Math.max(1, innerHeight);
      if (/ask|task|message|prompt|what|agent|type|instruction|goal|outcome/.test(hint)) points += 30;
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) points += 10;
      return points;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  };
  const setComposer = (el, text) => {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const findSubmit = (composer) => {
    const scope = composer.closest('form') || composer.parentElement?.parentElement || document;
    const buttons = [...scope.querySelectorAll('button,[role="button"]')].filter(visible);
    return buttons.map(btn => {
      const label = `${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`.toLowerCase();
      let score = 0;
      if (/send|run|start|execute|go|submit|arrow up|agent/.test(label)) score += 30;
      if (btn.type === 'submit') score += 20;
      const a = btn.getBoundingClientRect(), b = composer.getBoundingClientRect();
      score -= Math.abs(a.top - b.top) / 100;
      return { btn, score };
    }).sort((a, b) => b.score - a.score)[0]?.btn || null;
  };
  const observeProgress = () => {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || text === lastText) return;
        lastText = text;
        const tail = text.slice(-1600);
        const complete = /\b(task complete|workflow complete|completed|done|finished|success)\b/i.test(tail);
        const failed = /\b(task failed|workflow failed|fatal error|unable to complete|could not complete)\b/i.test(tail);
        const type = failed ? 'TITAN_OUTCOME_ERROR' : complete ? 'TITAN_OUTCOME_RESULT' : 'TITAN_OUTCOME_PROGRESS';
        if (!lastRequestId || !lastCompanyId) return;
        emit(type, { requestId: lastRequestId, company_id:lastCompanyId, outcome: lastOutcome, worker:lastWorker, text: tail, source: 'retriever-dom' });
        await appendEvent({ level: failed ? 'error' : 'info', source: 'retriever-dom', type, requestId: lastRequestId, company_id:lastCompanyId, text: tail.slice(-500) });
        if (complete || failed) await saveState(complete ? 'complete' : 'error', { requestId: lastRequestId, company_id:lastCompanyId, outcome: lastOutcome });
      }, 350);
    });
    if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  const executeOutcome = async (requestId, outcome, details={}) => {
    const clean = String(outcome || '').trim();
    const company_id = String(details.company_id || details.context?.company_id || '').trim();
    if (!clean) throw new Error('Outcome is empty.');
    if (!requestId) throw new Error('Request ID is required.');
    if (!company_id) throw new Error('Canonical company_id is required.');
    if (lastRequestId === requestId && lastCompanyId && lastCompanyId !== company_id) throw new Error('Request ID cannot be rebound to another company_id.');
    const composer = findComposer();
    if (!composer) throw new Error('Retriever composer not found.');
    lastRequestId = requestId;
    lastCompanyId = company_id;
    lastOutcome = String(details.displayOutcome || clean);
    lastWorker = details.worker || null;
    setComposer(composer, clean);
    const submit = findSubmit(composer);
    if (submit) submit.click();
    else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    observeProgress();
    await saveState('running', { requestId, company_id, outcome: lastOutcome, workerId:lastWorker?.id||null, composer: composer.tagName });
    await appendEvent({ level: 'info', source: 'retriever-bridge', type: 'outcome-started', requestId, company_id });
    emit('TITAN_OUTCOME_ACCEPTED', { requestId, company_id, outcome: lastOutcome, worker:lastWorker, source: 'retriever-bridge' });
  };

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (event.source !== window.parent) return;
    if (msg.type === 'TITAN_RETRIEVER_PING') {
      emit('TITAN_RETRIEVER_READY', { requestId: msg.requestId, composerReady: !!findComposer(), source: 'retriever-bridge' });
      return;
    }
    if (msg.type === 'TITAN_EXECUTE_OUTCOME' || msg.type === 'TITAN_RETRIEVER_EXECUTE') {
      const company_id = String(msg.company_id || msg.context?.company_id || '').trim();
      executeOutcome(String(msg.requestId || ''), msg.outcome,{displayOutcome:msg.displayOutcome,worker:msg.worker,company_id,context:msg.context}).catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await saveState('error', { requestId: msg.requestId, company_id:company_id||null, error: message });
        await appendEvent({ level: 'error', source: 'retriever-bridge', type: 'outcome-start-failed', requestId: msg.requestId, company_id:company_id||null, message });
        emit('TITAN_OUTCOME_ERROR', { requestId: msg.requestId, company_id:company_id||null, outcome: msg.outcome, text: message, source: 'retriever-bridge' });
      });
    }
  });

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !['status-update', 'task-completed', 'task-failed'].includes(msg.type)) return false;
      const type = msg.type === 'task-completed' ? 'TITAN_OUTCOME_RESULT' : msg.type === 'task-failed' ? 'TITAN_OUTCOME_ERROR' : 'TITAN_OUTCOME_PROGRESS';
      const text = String(msg.error || msg.message || msg.status || msg.result?.summary || msg.result?.data || msg.type);
      if (!lastRequestId || !lastCompanyId) return false;
      const payload = { requestId: lastRequestId, company_id:lastCompanyId, outcome: lastOutcome, worker:lastWorker, text, source: 'retriever-runtime', taskId: msg.taskId || msg.id || null };
      emit(type, payload);
      appendEvent({ level: msg.type === 'task-failed' ? 'error' : 'info', source: 'retriever-runtime', type: msg.type, taskId: payload.taskId, requestId:lastRequestId, company_id:lastCompanyId, text: text.slice(0, 1000) });
      saveState(msg.type === 'task-completed' ? 'complete' : msg.type === 'task-failed' ? 'error' : 'running', { requestId: lastRequestId, company_id:lastCompanyId, taskId: payload.taskId });
      return false;
    });
  } catch (_) {}

  const announce = () => {
    const ready = !!findComposer();
    saveState(ready ? 'ready' : 'loading', { composerReady: ready });
    emit('TITAN_RETRIEVER_READY', { composerReady: ready, source: 'retriever-bridge' });
    if (!ready) setTimeout(announce, 900);
  };
  setTimeout(announce, 250);
})();
