# Web deployment tests

`test:web:deployment` gates Hosting and Firestore rules releases. The early
`deploy_scope` job writes `web-test-scope.json` using the exact verified
`deployed/web-production` commit used to scope the release. This includes changes
from superseded pipelines, and works for reverts or non-ancestor markers.

For a small change, `runWebTests.js` asks Jest for the suites depending on **each**
changed source, JSON file, test or snapshot. `listRelatedJestTests.js` answers for
all of them from one Jest process; if it fails or leaves an input out, the runner
asks the Jest command line once per input instead, which gives the same answer
more slowly. A changed co-located test never
replaces the source input. It also runs `web-test-smoke.json` (startup, login,
navigation, lifecycle and assistant chat) and all suites that read source files
directly, since those checks bypass Jest's import graph.

The complete suite runs when the comparison or discovery is unavailable, a
changed input has no test mapping, a dependency is removed/renamed, styles/assets
change, shared startup/configuration/mocks/translations change, or more than 30
inputs change. A missing or mismatched plan also runs the complete suite.

The first production deployment after 24 hours runs the complete suite. After a
successful full run, CI records an annotated `deployed/web-full-tests` tag. Its
tagger time is the validation time, independent of the source commit date.
Failed or superseded runs cannot advance this marker; a missing marker or failed
marker write conservatively requires another full run. No separate scheduled
deployment is created. Develop retains full-suite validation; feature branches
use the same selector against their merge base, without the periodic marker.

The job runs as four parallel copies (`parallel: 4`). Each copy takes the suites
whose path hashes to its number (`CI_NODE_INDEX` of `CI_NODE_TOTAL`), so the
copies together run every selected suite exactly once, also when one copy falls
back to the complete suite. A copy that gets none of the selected suites passes
and says so; `deploy:web` waits for all copies.

Logs state the selection reason and selected/total suite counts. Test failures
remain blocking, and `web-test-result.json` is written only after tests pass.
