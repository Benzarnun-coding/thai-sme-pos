#!/usr/bin/env bash
# Copy the team's agents and skills into ~/.claude (user level, so they work in every project).
# Anything with the same name is moved to ~/.claude/backup-<time>/ first, never overwritten in place.
set -euo pipefail

src="$(cd "$(dirname "$0")" && pwd)"
dest="${CLAUDE_HOME:-$HOME/.claude}"
backup="$dest/backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$dest/agents" "$dest/skills"

for f in "$src"/agents/*.md; do
  name="$(basename "$f")"
  if [ -e "$dest/agents/$name" ]; then
    mkdir -p "$backup/agents"
    mv "$dest/agents/$name" "$backup/agents/"
  fi
  cp "$f" "$dest/agents/$name"
  echo "agent  ${name%.md}"
done

for d in "$src"/skills/*/; do
  name="$(basename "$d")"
  if [ -e "$dest/skills/$name" ]; then
    mkdir -p "$backup/skills"
    mv "$dest/skills/$name" "$backup/skills/"
  fi
  cp -R "$d" "$dest/skills/$name"
  echo "skill  /$name"
done

[ -d "$backup" ] && echo "old files with the same names were moved to $backup"
echo "done. start the lead with:  claude --agent helm"
