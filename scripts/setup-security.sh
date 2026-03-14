#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-devartifex/copilot-unleashed}"

get_security_status() {
  local field="$1"

  gh api "/repos/$REPO" --jq ".security_and_analysis.${field}.status // \"disabled\"" 2>/dev/null
}

print_current_status() {
  echo ""
  echo "📋 Current security settings:"
  gh api "/repos/$REPO" --jq '{
    secret_scanning: .security_and_analysis.secret_scanning.status,
    push_protection: .security_and_analysis.secret_scanning_push_protection.status
  }' 2>/dev/null || echo "⚠️  Run with repo admin permissions to verify"
}

if ! secret_scanning_status="$(get_security_status 'secret_scanning')"; then
  echo "❌ Unable to read current secret scanning status for $REPO"
  echo "   Make sure gh is authenticated and you have repository admin access."
  exit 1
fi

if ! push_protection_status="$(get_security_status 'secret_scanning_push_protection')"; then
  echo "❌ Unable to read current push protection status for $REPO"
  echo "   Make sure gh is authenticated and you have repository admin access."
  exit 1
fi

echo "🔒 Checking current secret scanning configuration for $REPO..."
echo "   Secret scanning: ${secret_scanning_status}"
echo "   Push protection: ${push_protection_status}"

patch_args=()

if [[ "$secret_scanning_status" != "enabled" ]]; then
  echo "🔒 Enabling secret scanning..."
  patch_args+=(-f "security_and_analysis.secret_scanning.status=enabled")
else
  echo "✅ Secret scanning is already enabled"
fi

if [[ "$push_protection_status" != "enabled" ]]; then
  echo "🛡️  Enabling push protection..."
  patch_args+=(-f "security_and_analysis.secret_scanning_push_protection.status=enabled")
else
  echo "✅ Push protection is already enabled"
fi

if (( ${#patch_args[@]} > 0 )); then
  gh api -X PATCH "/repos/$REPO" "${patch_args[@]}" --silent
  echo "✅ Repository security settings updated"
else
  echo "✅ No changes needed"
fi

print_current_status
