---
description: 'Diagnose and fix a bug systematically'
---

Fix the reported bug using this systematic approach:

## Investigation
1. Reproduce the bug (identify exact steps)
2. Check relevant test files for missing coverage
3. Trace the data flow: Component → Store → WebSocket → Handler → SDK
4. Identify root cause

## Fix
1. Write a failing test first (unit or E2E depending on bug location)
2. Implement the minimal fix
3. Verify the test passes
4. Check for similar patterns elsewhere in the codebase
5. Run full test suite: `npm run test:unit && npm run check && npm run build`

## Verification
- [ ] Bug is reproducible before fix
- [ ] Fix addresses root cause (not just symptoms)
- [ ] New test covers the bug scenario
- [ ] No regressions in existing tests
- [ ] Works on all 3 device profiles if UI-related
