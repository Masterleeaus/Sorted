// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/packaged-catalog.mjs
import * as moduleHealth from './builtin/module-health/index.js';
import * as businessServices from './builtin/business-services/index.js';
import * as workforceVerticals from './builtin/workforce-verticals/index.js';

// Manifest V3 extension service workers require all executable packaged modules to be statically imported.
export const PACKAGED_MODULES = Object.freeze({
  'titan.module-health': moduleHealth,
  'titan.business-services': businessServices,
  'titan.workforce-verticals': workforceVerticals,
});
