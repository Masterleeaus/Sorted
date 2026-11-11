import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("scripts/deploy.sh","utf8");
test("workstation deploy uses a quoted branch argument and the canonical entrypoint",()=>{
  assert.match(code,/sorted_validate_deploy_branch "\$BRANCH"/);
  assert.match(code,/ssh garonhome bash -s -- "\$BRANCH" <<'REMOTE'/);
  assert.match(code,/DEPLOY_BRANCH="\$branch" bash scripts\/deploy-garonhome\.sh/);
});
test("wrapper cannot reset host checkout independently",()=>{
  assert.doesNotMatch(code,/git reset --hard/);
  assert.doesNotMatch(code,/git checkout "\$BRANCH"/);
  assert.doesNotMatch(code,/git fetch origin/);
});
