// @ts-nocheck
// Ported from Titan Zero extension (portable-core): main-redirect.js
'use strict';
const target='sidePanel.html?view=chat&fullscreen=1';
if (!location.pathname.endsWith('/sidePanel.html')) location.replace(target);
