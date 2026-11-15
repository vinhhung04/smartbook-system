#!/usr/bin/env bash
# Rebuild the Diagram Design figures of the thesis (profile "smartbook"), check them and export SVG/PNG.
#
#   bash scripts/diagrams/diagram-design/build.sh            # from the repository root
#
# Env:
#   PYTHON           interpreter with Playwright + Chromium (default: python; on this machine python3 lacks Playwright)
#   DD_SKILL_DIR     installed diagram-design skill dir (default: newest under ~/.claude/plugins/cache/diagram-design)
#   DD_REPO_CHECKOUT optional clone of github.com/cathrynlavery/diagram-design, enables scripts/verify-geometry.py
set -u
export PYTHONIOENCODING=utf-8
PY="${PYTHON:-python}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SK="${DD_SKILL_DIR:-$(ls -d "$HOME"/.claude/plugins/cache/diagram-design/diagram-design/*/skills/diagram-design 2>/dev/null | sort -V | tail -1)}"
[ -f "$SK/scripts/self_check.py" ] || { echo "diagram-design skill not found (set DD_SKILL_DIR)"; exit 2; }
WORD="$(mktemp -d)"
D=docs/diagrams/designed

# 1. generate the self-contained HTML sources
for g in fig_auth fig_ai fig_vnpay fig_seq_legacy; do "$PY" "$HERE/$g.py" "$D/sequence" >/dev/null || exit 1; done
"$PY" "$HERE/fig_erd.py" "$D/erd" >/dev/null || exit 1
"$PY" "$HERE/fig_erd_legacy.py" "$D/erd" >/dev/null || exit 1
for g in fig_arch41 fig_deploy42 fig_cicd61 fig_51 fig_domain; do "$PY" "$HERE/$g.py" "$D/architecture" >/dev/null || exit 1; done
"$PY" "$HERE/fig_usecase.py" "$D/use-case" >/dev/null || exit 1
"$PY" "$HERE/fig_activity.py" "$D/activity" >/dev/null || exit 1
"$PY" "$HERE/fig_ch2.py" "$D" >/dev/null || exit 1     # figures 1.1, 2.1-2.6 (architecture, sequence, activity)

# 2. check and export
rc=0
for type in sequence erd architecture use-case activity; do
  mkdir -p "docs/diagrams/exports/svg/$type" "docs/diagrams/exports/png/$type"
  for f in "$D/$type"/*-dd*.html; do
    b="$(basename "${f%.html}")"; out=""
    "$PY" -I "$SK/scripts/self_check.py" --offline "$f" >/dev/null && out+="self_check=OK " || { out+="self_check=FAIL "; rc=1; }
    if [ -n "${DD_REPO_CHECKOUT:-}" ]; then
      "$PY" -I "$DD_REPO_CHECKOUT/scripts/verify-geometry.py" "$f" >/dev/null && out+="geometry=OK " || { out+="geometry=FAIL "; rc=1; }
    fi
    "$PY" scripts/diagrams/check-text-fit.py "$f" --word-png "$WORD/$b.png" >/dev/null && out+="text-fit=OK " || { out+="text-fit=FAIL "; rc=1; }
    "$PY" -I "$SK/scripts/export_svg.py" "$f" "docs/diagrams/exports/svg/$type/$b.svg" --system-fonts >/dev/null || { out+="svg=FAIL "; rc=1; }
    "$PY" -I "$SK/scripts/export_png.py" "$f" "docs/diagrams/exports/png/$type/$b.png" 3 >/dev/null || { out+="png=FAIL "; rc=1; }
    echo "$b: $out"
  done
done
echo "16 cm previews: $WORD"
exit $rc
