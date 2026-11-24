#!/usr/bin/env bash
# Usage: bash scripts/check-npm-consumer.sh node|bun /absolute/package.tgz 1.0.0
# A registry spec (project-pulse or project-pulse@VERSION) exercises the public install instead.
set -euo pipefail

runtime=$1
spec=$2
version=$3
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin" "$work/home" "$work/project"
ln -s /bin/sh "$work/bin/sh" # npm exec spawns sh via PATH.

# Run only the target runtime and its installers, from a fresh home without registry credentials.
case "$runtime" in
  node)
    for cmd in node npm npx; do
      ln -s "$(command -v "$cmd")" "$work/bin/$cmd"
    done
    absent=bun
    ;;
  bun)
    for cmd in bun bunx; do
      ln -s "$(command -v bun)" "$work/bin/$cmd"
    done
    absent=node
    ;;
  *) echo "Expected runtime node or bun, got $runtime" >&2; exit 2 ;;
esac
run() {
  env -i PATH="$work/bin" HOME="$work/home" PROJECT_PULSE_HOME="$work/pulse-home" \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org NPM_CONFIG_IGNORE_SCRIPTS=true "$@"
}
run /bin/sh -ec '! command -v "$1"' sh "$absent"
echo "Consumer: $runtime $(run "$runtime" --version); $absent absent; $spec"
cd "$work/project"

if [[ "$runtime" == node ]]; then
  if [[ "$spec" == /* ]]; then
    test "$(run npx --yes --package="$spec" project-pulse --version)" = "$version"
  else
    test "$(run npx --yes "$spec" --version)" = "$version"
  fi
  run npm install -g --ignore-scripts --prefix "$work/prefix" "$spec"
  test "$(run "$work/prefix/bin/project-pulse" --version)" = "$version"
  pp=("$work/prefix/bin/pp")
else
  if [[ "$spec" != /* ]]; then
    test "$(run bunx --bun "$spec" --version)" = "$version"
  fi
  printf '{"name":"consumer-smoke","private":true}\n' > package.json
  run bun add --ignore-scripts "$spec"
  test "$(run bunx --bun --no-install project-pulse --version)" = "$version"
  pp=(bunx --bun --no-install pp)
fi

test "$(run "${pp[@]}" --version)" = "$version"
run "${pp[@]}" init --name 'Package smoke'
grep -Fx '# Package smoke — Roadmap' ROADMAP.md
run "${pp[@]}" feature add probe --title 'Package probe'
run "${pp[@]}" feature note probe 'round-trip'
run "${pp[@]}" show probe --json | jq -e '[.. | objects | .note?] | index("round-trip") != null' >/dev/null
run "${pp[@]}" summary > summary.txt
grep -F 'Package smoke' summary.txt
run "${pp[@]}" check
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  | run "${pp[@]}" mcp > response.json
jq -se 'length == 1 and .[0].id == 1 and .[0].result.serverInfo.name == "project-pulse"' response.json >/dev/null
echo "PASS: both aliases, persisted note, summary, check, and MCP initialize"
