#!/usr/bin/env bash
set -euo pipefail

REPO="devartifex/copilot-unleashed"
BRANCH="master"

echo "🔒 Setting up branch protection for $BRANCH..."

gh api -X PUT "/repos/$REPO/branches/$BRANCH/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["check", "e2e", "commit-lint"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
EOF

echo "✅ Branch protection configured for $BRANCH"
echo ""
echo "📋 Current protection rules:"
gh api "/repos/$REPO/branches/$BRANCH/protection" --jq '{
  required_reviews: .required_pull_request_reviews.required_approving_review_count,
  status_checks: .required_status_checks.contexts,
  linear_history: .required_linear_history.enabled,
  force_push: .allow_force_pushes.enabled,
  conversation_resolution: .required_conversation_resolution.enabled
}' 2>/dev/null || echo "⚠️ Run with admin access to verify"
