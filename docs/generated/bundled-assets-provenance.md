# Bundled compatibility assets: provenance inventory

Date: 2026-11-08. Issue #11. Base commit: 9d801e1.
Scope: 50 tracked files under `packages/titan-platform/src/` that are bundled, minified, compatibility or vendor output. Found by name and size (`*.iife.*`, `assets/`, `*.compat.*`, `*.min.*`, `*.bundle.json`). The `apps/web/app/api/v1/assets/route.ts` source file matched the name pattern and is excluded.

Method: sha256 and byte size from the tracked files. Origin, upstream and license come only from in-file headers and notices. Anything not stated in a file is marked UNKNOWN. No license was inferred from a filename. Nothing in the source was changed.

## Summary

- Total: 50 files, 64,220,549 bytes (about 64 MB, of which 28.6 MB is one file).
- Every `.ts` file carries an in-file port header ("Ported from Titan Zero extension ..."). CSS files and the JSON data bundle do not.
- License: 1 file has a stated license (`pdf.worker.min.ts`, Apache-2.0). 3 compat bundles carry several third-party notices with no single license. 46 files have no license statement. Package-level license is UNKNOWN for 49 of 50.
- Frozen snapshots: all 50. No script or config in the repo generates them. They are outside `packages/titan-platform/tsconfig.json` and the `package.json` exports, and the `.ts` headers say "QUARANTINE: not exported to standalone runtime". They are referenced only by JSON inventories and by two in-tree HTML pages that load CSS (`side-panel/index.html`, `monicaOptions.html`). Exception: `cleaning-workforce.bundle.json` is read by one test.
- Upstream version or commit: UNKNOWN for all files. No version or commit is recorded in the files themselves.

## Owner and update policy (PROPOSAL, needs owner confirmation)

Nothing below is decided. It is a starting point for the owner.

1. Owner: UNKNOWN. The owner must name one person or team.
2. Treat these as frozen vendor snapshots. Do not hand-edit them. Prefer deleting or replacing them at the source over patching them in place.
3. Keep upstream notices in place. Do not strip the in-file notices from the compat bundles or `pdf.worker.min.ts`.
4. Any new bundled file must get a row in this document in the same change. `pnpm check:titan-manifest` warns when a bundle-like file under `packages/titan-platform/src/` is not listed here.
5. If an asset must be refreshed, rebuild it from a named Titan Zero extension commit. Record the commit, the build command and the new sha256 here.
6. Before shipping any of these files to production, the owner must confirm the license position for the mixed bundles and for the files marked UNKNOWN.

## Open questions for the owner

- Who owns each asset, and is each still needed? Most have no live importer, so deletion candidates should go to issue #4.
- Is `pdf.worker.min.ts` needed? It has no importer in the repo.
- Are the compat bundles' third-party notices (React, lucide-react, DOMPurify and others) complete? That needs a license review against the real upstream packages.
- Is the Google OAuth client ID in the `config-*.ts` chunks meant to ship?
- Does `titan-zero-chat-content.compat.ts` match the upstream `content.js` in the merge-42 audit? The byte sizes differ (28,593,131 bytes of payload against 28,593,053).

## Per-asset inventory

### `packages/titan-platform/src/ported/content-main/all.iife.ts`
- Bytes: 65,765
- SHA-256: `2ee2ef94c505e6451d996f025cde87ad2b5730c14e04f16869186eb33c687caf`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original content-main/all.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/content-runtime/actions.iife.ts`
- Bytes: 125,714
- SHA-256: `5398b2e5a6e0a3dcd5139890555758b606860beebe50d2c9c176d822d4e35bb8`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original content-runtime/actions.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/content-runtime/all.iife.ts`
- Bytes: 1,794
- SHA-256: `594f1a96b5f1748b7da4d51d4f91cffb85909cb952411bd4537ddabbb88b6a2f`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original content-runtime/all.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/content-runtime/network.iife.ts`
- Bytes: 14,647
- SHA-256: `d5d3c6f2b3c1a6532c3810b287f7eea743b33f905dbd6b165fd16b6db1135cec`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original content-runtime/network.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/content-runtime/page-tool.iife.ts`
- Bytes: 71,748
- SHA-256: `55db539e90df2e016786922411849263419e47470512d94c7263fd53083e69a4`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original content-runtime/page-tool.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/content-runtime/scroll.iife.ts`
- Bytes: 20,273
- SHA-256: `15de05f86a3ee601f5ca0131ef217deeb933ffa2fa2fbff641dc572d447ca2af`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original content-runtime/scroll.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/content/all.iife.ts`
- Bytes: 1,036,667
- SHA-256: `2926466f3d1d7c828c7a6c41f69cdc4e682d531c4d8ccd97efb09e3264e361e4`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original content/all.iife.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/microphone-permission/assets/index-B0effiU7.ts`
- Bytes: 6,753
- SHA-256: `cef5168273c52cb0fb53823607a20ff580c1ce731b7554f8f2400d1d6e10a7f5`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original microphone-permission/assets/index-B0effiU7.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/microphone-permission/assets/index-DFkOzR6y.css`
- Bytes: 1,540
- SHA-256: `d41a6b82de8b2a6844db59faf2851946082dae7d00c4505dc4be1ada6a9f47aa`
- Origin (from file header): No port header (Vite chunk or JSON data)
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes

### `packages/titan-platform/src/ported/offscreen/assets/auth-manager-pH2QX7Jc.ts`
- Bytes: 55,748
- SHA-256: `4f253619b52773aba4df7ef996765744f7eefaf84c160d4f4dd53a513b004b38`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/auth-manager-pH2QX7Jc.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/config-D7CGfrNC.ts`
- Bytes: 1,272
- SHA-256: `d9869aefddea15d9c03019c27b10cf404cedb769e14ba8ec103a78c05febdcc7`
- Origin (from file header): Titan Zero extension, "portable-core", original offscreen/assets/config-D7CGfrNC.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Contains a Google OAuth client ID literal; owner to confirm it is meant to ship; Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/file-upload-utils-Bn4gpMXH.ts`
- Bytes: 11,452
- SHA-256: `af917af0fc6b78d8aa478b74b185f00a66441049381ae4a9666ff0c790de35c7`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/file-upload-utils-Bn4gpMXH.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/index-4v886BK9.ts`
- Bytes: 15,366
- SHA-256: `cf0a01e0973afdd4c4810102d837953cb3c2859e3d50ee76aef91587b0c7ee55`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/index-4v886BK9.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/index-B1QDSbwU.ts`
- Bytes: 1,063,917
- SHA-256: `6e8e8aea848a234e36bc45ab8ff4f39e33dbd5d882408aba310a5ce664c9759b`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/index-B1QDSbwU.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/index-BzYwgI7n.ts`
- Bytes: 21,027
- SHA-256: `28b073e5c6e2d9480f749c562e94412634c00865d171d686586fc64aa3945c9b`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/index-BzYwgI7n.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/index-CS09ynNq.ts`
- Bytes: 7,176
- SHA-256: `6b8f7c91a101b7914804af8c1929ef6abdce1a53331a103bd9667b256d7badc6`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original offscreen/assets/index-CS09ynNq.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/index-D08rqSxx.ts`
- Bytes: 110,127
- SHA-256: `1bcf333eaea808063b31638c4ed2bda327740dca139738ac8822297e413a4bbc`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/index-D08rqSxx.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/index-DQ9Twk9f.ts`
- Bytes: 27,053
- SHA-256: `96e144ad36c2e77e22c4e756a7af2991fd6e3c9c4390d1003035712198d45ba4`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original offscreen/assets/index-DQ9Twk9f.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/llmConfigService-BZXHyOeL.ts`
- Bytes: 9,133
- SHA-256: `e10bf2bc5579c8c31a546daafe78791b089f591bcf541bcecedf357da61a3d9a`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/llmConfigService-BZXHyOeL.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/skill-types-DTME2ioz.ts`
- Bytes: 2,641
- SHA-256: `284ee45ef99fa1d45a4d398a39e72e8757549e47f643d7086427cdcdcf523662`
- Origin (from file header): Titan Zero extension, "portable-core", original offscreen/assets/skill-types-DTME2ioz.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/skillStorageService-D4Lkoz90.ts`
- Bytes: 7,029
- SHA-256: `679e891807b52676ba0f74c97c0240feee5756ffdbf8476bc6a859afdb5cb85e`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original offscreen/assets/skillStorageService-D4Lkoz90.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/storageUtils-DkecF1NS.ts`
- Bytes: 81,170
- SHA-256: `c3dde2b7e336769e04884103c993c19154c7d6cef735b6a9ecb65eaa788cdc6f`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/storageUtils-DkecF1NS.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/unifiedFunctionExecutor-4UtoSB3u.ts`
- Bytes: 1,009,027
- SHA-256: `d0ab02c9b9e9893d6c43e921c6cf6f2458e3da9b5ed4c79e2d476da77a5da016`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original offscreen/assets/unifiedFunctionExecutor-4UtoSB3u.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/offscreen/assets/upload-bytes-store-Bc_5AyUo.ts`
- Bytes: 3,403
- SHA-256: `600126d17961aea1bfd1f1ba936aa49b6d2a13a2459185bedf38161db40eef82`
- Origin (from file header): Titan Zero extension, "portable-core", original offscreen/assets/upload-bytes-store-Bc_5AyUo.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/retriever-background.iife.ts`
- Bytes: 2,731,990
- SHA-256: `b252c7a0986614660fc6b4c66074d2f3ad1191f6b5c0a63be8d56b793ae10b5d`
- Origin (from file header): No port header (Vite chunk or JSON data)
- Upstream project: Titan Zero retriever background script
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes. Header marks it RETIRED, provenance/recovery only
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/auth-manager-CpMXLbRb.ts`
- Bytes: 55,768
- SHA-256: `5f55d25ef19ef0e0fece7c6f97760d66c61458b1d8dbcdea489b4b29ce2acc61`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/auth-manager-CpMXLbRb.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/codePlanAgent-Bw8EfqoC.ts`
- Bytes: 44,947
- SHA-256: `854826284b18829a2c5ca7055bcd7e6a50a00e016addf606bf66baf75360f8dd`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/codePlanAgent-Bw8EfqoC.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/config-CnHu_OKe.ts`
- Bytes: 1,260
- SHA-256: `95c8185d45d1f132283dc258476031fec4f4aaeb463ea609026032da3768339e`
- Origin (from file header): Titan Zero extension, "portable-core", original side-panel/assets/config-CnHu_OKe.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Contains a Google OAuth client ID literal; owner to confirm it is meant to ship; Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/file-upload-utils-tcH63QNg.ts`
- Bytes: 11,413
- SHA-256: `8d8b43f296ea908ac6b639a41314c5d1140f5ff58680ed82064c83d00d68916c`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/file-upload-utils-tcH63QNg.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/index-BOnJaAYV.css`
- Bytes: 334,250
- SHA-256: `e1897a14562c87504adcabd7e07f8175a75771de21e1efdeec96ebe02fcf42f3`
- Origin (from file header): No port header (Vite chunk or JSON data)
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes

### `packages/titan-platform/src/ported/side-panel/assets/index-BzklHw8Q.ts`
- Bytes: 9,536
- SHA-256: `1b65d59b9b4f804f33b0092f5a2364ecc716634bcaecedf90be960fb6d43c2e7`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/index-BzklHw8Q.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/index-C8c-GDqp.ts`
- Bytes: 1,525,249
- SHA-256: `10b6faa85974cfc9653db9eba6377b0f556e091bb82cfd98275c3527e6ed0045`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/index-C8c-GDqp.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/index-CBmBD00K.ts`
- Bytes: 7,154
- SHA-256: `ab48ceb0e54aa808d9d9f8f061713554c97d2605a05da041cacf137e646e381a`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original side-panel/assets/index-CBmBD00K.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/index-DmDSrWNU.ts`
- Bytes: 73,040
- SHA-256: `a1a8c65d177005405931329889b437e08e1196bf7d2946ae694b3b644da00dfc`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/index-DmDSrWNU.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/index-DoGUjCY-.ts`
- Bytes: 15,337
- SHA-256: `136c05c9b2dcdb55de5ed3813f71ed729ddc3f0ca397929136644b748d78ba45`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/index-DoGUjCY-.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/llmConfigService-FC6T5-i7.ts`
- Bytes: 9,178
- SHA-256: `84f532789d88d1b268ec3fe32411fc8ad1c1bbaccd48a1addfa2522a74212fc0`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/llmConfigService-FC6T5-i7.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/skillStorageService-LGvOYmp_.ts`
- Bytes: 6,523
- SHA-256: `3bf79c2e419344ef5dcecb61c7d36396be32d339a0f4747de13938c429a7e96a`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original side-panel/assets/skillStorageService-LGvOYmp_.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/storageUtils-CrD87Pln.ts`
- Bytes: 21,846
- SHA-256: `e21406c094a6bb635a3562775fa8d65b89ebd837eae32a3206a4fc2dd89174e7`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/storageUtils-CrD87Pln.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/upload-bytes-store-Bc_5AyUo.ts`
- Bytes: 3,404
- SHA-256: `428a9a10a63e87335bf02e602ade5da00612d8b8460ace6229009a9bb7415d49`
- Origin (from file header): Titan Zero extension, "portable-core", original side-panel/assets/upload-bytes-store-Bc_5AyUo.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/userSettingsService-BbHxwq7x.ts`
- Bytes: 7,848
- SHA-256: `28857f9a4ab6cb8c9f899be4fb14df69f9d243831e1287d67c4642e584f05ec0`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original side-panel/assets/userSettingsService-BbHxwq7x.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/vendor-CRCSbEcK.ts`
- Bytes: 936,005
- SHA-256: `ae22d62b134c1a219687f426cc16b0f0d29065c007e9b619e019734a20cd377f`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original side-panel/assets/vendor-CRCSbEcK.js
- Upstream project: Vendored third-party bundle (identity UNKNOWN)
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/vendor-firebase-DmzjWjiQ.ts`
- Bytes: 471,892
- SHA-256: `049a7e761b5fef740439afec51f09d2721ceb1da7c888a248b2bd10410d2696c`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/vendor-firebase-DmzjWjiQ.js
- Upstream project: Firebase SDK (inferred from filename only)
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/side-panel/assets/workflowSandboxPool-C43aNRZy.ts`
- Bytes: 14,386
- SHA-256: `434d556814f7d96bf7ca590bab9f7f05a07629c8281080a71b4f28a9cd35e54e`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original side-panel/assets/workflowSandboxPool-C43aNRZy.js
- Upstream project: Titan Zero extension build output (Vite chunk); bundled libraries not identified
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/static/pdf.worker.min.ts`
- Bytes: 1,361,163
- SHA-256: `d9a3e1a4e33926b7e9fa8668213f18db21d414f97f557b65beaabd3b2df2e5df`
- Origin (from file header): Titan Zero extension, "ui-or-browser-adaptation", original static/pdf.worker.min.mjs
- Upstream project: pdf.js (Mozilla); version UNKNOWN
- License (stated in file): Apache-2.0 (in-file @licstart notice, Copyright 2023 Mozilla Foundation)
- Frozen snapshot: Yes
- Local changes and notes: Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/titan-modules/bundles/cleaning-workforce.bundle.json`
- Bytes: 107,542
- SHA-256: `29c8267bd3ec6f6f8e0228c2355ef7d8d4fe63a8115a3c1c19853714bf5bd8b1`
- Origin (from file header): No port header (Vite chunk or JSON data)
- Upstream project: Titan product data (own description: converged cleaning workforce pack); no third-party code
- License (stated in file): UNKNOWN (no license field; ownership to confirm)
- Frozen snapshot: Frozen export read by tests/cleaning-vertical-pass04.test.mjs

### `packages/titan-platform/src/ported/titan-zero-chat-background.compat.ts`
- Bytes: 11,561,506
- SHA-256: `21e314ccc42188572a2ab716998e11d11f58a5361cc3f4c1b2e843205f155d9e`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original titan-zero-chat-background.compat.js
- Upstream project: Titan Zero chat background bundle (React and others)
- License (stated in file): Mixed, not one license. In-file notices: MIT (React, others). Package-level: UNKNOWN
- Frozen snapshot: Yes
- Local changes and notes: Prepends port header; Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/titan-zero-chat-content.compat.css`
- Bytes: 2,543,371
- SHA-256: `bac75be20e6f66f1ea5291141a2067157687a764012c5fc8478ce6191f9e464c`
- Origin (from file header): No port header (Vite chunk or JSON data)
- Upstream project: Titan Zero chat content stylesheet; includes third-party CSS notices
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Byte-identical to content.css in merge-42 audit

### `packages/titan-platform/src/ported/titan-zero-chat-content.compat.ts`
- Bytes: 28,593,450
- SHA-256: `3d8dbe7ae5f40e24b07b9c91d5602e7e0e0413091d80ec9a69fc957ae0867b36`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original titan-zero-chat-content.compat.js
- Upstream project: Titan Zero chat content script bundle (React, lucide-react, DOMPurify and others)
- License (stated in file): Mixed, not one license. In-file notices: ISC (lucide-react v0.476.0), MIT (React, others), Apache-2.0 OR MPL-2.0 (DOMPurify). Package-level: UNKNOWN
- Frozen snapshot: Yes
- Local changes and notes: Prepends console no-op stubs and a port header; Payload is not byte-identical to content.js in the merge-42 audit (sha 8e2062...); relation UNKNOWN; Prepends @ts-nocheck and QUARANTINE port header

### `packages/titan-platform/src/ported/titan-zero-chat-runtime.compat.css`
- Bytes: 2,223,230
- SHA-256: `3efa011dc4965bf2035763086654bfa223a1a9a86aea849be1703fa500c6f845`
- Origin (from file header): No port header (Vite chunk or JSON data)
- Upstream project: Titan Zero chat runtime stylesheet; includes third-party CSS notices
- License (stated in file): UNKNOWN (no license statement in file)
- Frozen snapshot: Yes
- Local changes and notes: Byte-identical to monica-popup.css in merge-42 audit

### `packages/titan-platform/src/ported/titan-zero-chat-runtime.compat.ts`
- Bytes: 7,778,819
- SHA-256: `fa9b0e66469ab9cc7bf76fdbdb858c7a78c13ec5ae541f7af70250ffb9d64b3a`
- Origin (from file header): Titan Zero extension, "browser-adapter-required", original titan-zero-chat-runtime.compat.js
- Upstream project: Titan Zero chat runtime bundle (React and others)
- License (stated in file): Mixed, not one license. In-file notices: MIT (React, others), Apache-2.0 OR MPL-2.0 (DOMPurify). Package-level: UNKNOWN
- Frozen snapshot: Yes
- Local changes and notes: Prepends console no-op stubs and a port header; Prepends @ts-nocheck and QUARANTINE port header
