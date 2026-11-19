#!/usr/bin/env bash
# Explicit owner operation. No file contents, database state or history changed.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
check_only=0
case "${1:-}" in --check) check_only=1 ;; '') ;; *) die "usage: prepare-volumes.sh [--check]" ;; esac
[[ $# -le 1 ]] || die "usage: prepare-volumes.sh [--check]"
config="$(dc --profile operations config --format json)"
project="$(printf '%s' "$config" | jq -r '.name')"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "volume owner project identity missing"
expected='[{"source":"packing_evidence_data","target":"/recovery/packing"},{"source":"procurement_document_data","target":"/recovery/procurement"},{"source":"ai_model_cache","target":"/models"},{"source":"ai_cloakbrowser_cache","target":"/browser"}]'
printf '%s' "$config" | jq -e --argjson expected "$expected" '
  .services["prepare-volumes"] as $job |
  $job.user=="0:0" and $job.network_mode=="none" and $job.command==[] and
  $job.entrypoint==["chown","--no-dereference","-R","-P","--","1000:1000","/recovery/packing","/recovery/procurement","/models","/browser"] and
  (($job.volumes | map({type,source,target,read_only:(.read_only//false)}) | sort_by(.source)) ==
   ($expected | map(.+{type:"volume",read_only:false}) | sort_by(.source)))
' >/dev/null || die "owner helper must use only fixed named volumes, paths and physical chown"
while IFS= read -r source; do
  name="$(printf '%s' "$config" | jq -r --arg source "$source" '.volumes[$source].name')"
  [[ "$name" == "${project}_${source}" ]] || die "owner volume name differs from verified project"
  printf '%s' "$config" | jq -e --arg source "$source" '
    .volumes[$source] | (.external//false)==false and (.driver//"local")=="local" and ((.driver_opts//{})|length)==0
  ' >/dev/null || die "external/bind-backed owner volume forbidden"
  if metadata="$(docker volume inspect "$name" 2>/dev/null)"; then
    printf '%s' "$metadata" | jq -e --arg name "$name" --arg project "$project" --arg source "$source" '
      .[0] | .Name==$name and .Driver=="local" and ((.Options//{})|length)==0 and
      .Labels["com.docker.compose.project"]==$project and .Labels["com.docker.compose.volume"]==$source
    ' >/dev/null || die "existing owner volume identity mismatch"
  else
    listed="$(docker volume ls -q --filter "name=^${name}$")" || die "owner volume inventory unavailable"
    [[ -z "$listed" ]] || die "existing owner volume could not be verified"
  fi
done < <(printf '%s' "$expected" | jq -r '.[].source')
if [[ "$check_only" -eq 1 ]]; then log "Fixed named volume ownership boundaries verified; no changes made"; exit 0; fi
# Compose creates any missing local named volumes with this verified project.
dc --profile operations run --rm --no-deps -T prepare-volumes
log "Fixed application volume ownership prepared; file contents retained"
