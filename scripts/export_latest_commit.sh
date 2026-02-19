#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: ejecutá este script dentro de un repo git." >&2
  exit 1
fi

mkdir -p out

if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  git format-patch -1 HEAD --stdout > out/latest_commit.patch
else
  echo "Error: no hay commit anterior para exportar el último commit." >&2
  echo "Tip: hacé al menos 2 commits o exportá con git diff manualmente." >&2
  exit 1
fi

echo "Patch generado en: out/latest_commit.patch"
