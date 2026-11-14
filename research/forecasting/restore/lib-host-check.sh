# shellcheck shell=bash
# Shared production-host refusal for the research restore tools.
# Sourced by isolated-run.sh and fetch-and-run.sh so that BOTH refuse before
# anything is downloaded or restored on the shared BetGenius / School Kit VPS.
#
#   if reason=$(bgf_production_host_reason); then die "$reason"; fi
#
# Prints a reason and returns 0 when the host looks like production (or when
# the check itself cannot run: fail closed); returns 1 on an isolated machine.
# BGF_TEST_PROD_MARKERS / BGF_TEST_DOCKER / BGF_TEST_PROD_PORT are test seams.

bgf_listening_on() { # $1 = port; reads /proc so it needs no ss/netstat. 0 = listening, 1 = not, 2 = cannot tell
  # Only files that exist are read: a missing /proc/net/tcp6 (IPv6 disabled) must not make this
  # fail open, which a `cat a b | awk` pipeline under pipefail would.
  local hex f files=()
  hex=$(printf '%04X' "$1")
  for f in /proc/net/tcp /proc/net/tcp6; do [ -r "$f" ] && files+=("$f"); done
  [ ${#files[@]} -gt 0 ] || return 2
  awk -v p=":$hex" '$4 == "0A" && substr($2, length($2) - 4) == p { found = 1 } END { exit !found }' "${files[@]}"
}

bgf_production_host_reason() {
  local marker docker port rc
  for marker in ${BGF_TEST_PROD_MARKERS:-/opt/betgenius /opt/school-kit /opt/schoolkit}; do
    if [ -e "$marker" ]; then
      echo "$marker exists: this looks like the production VPS. Run on an isolated machine (docs section 11)."
      return 0
    fi
  done
  docker="${BGF_TEST_DOCKER:-docker}"
  if command -v "$docker" >/dev/null 2>&1; then
    if "$docker" ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' 2>/dev/null | grep -qiE 'betgenius|school'; then
      echo "BetGenius or School Kit containers are running on this host. Run on an isolated machine."
      return 0
    fi
    if "$docker" network ls --format '{{.Name}}' 2>/dev/null | grep -qx 'edge'; then
      echo "a Docker network named 'edge' exists (School Kit's shared network on the VPS). Run on an isolated machine."
      return 0
    fi
  fi
  port="${BGF_TEST_PROD_PORT:-5433}"
  rc=0; bgf_listening_on "$port" || rc=$?
  if [ "$rc" = 0 ]; then
    echo "something listens on port $port, the VPS Postgres host port. Run on an isolated machine."
    return 0
  fi
  if [ "$rc" = 2 ]; then
    echo "cannot read /proc/net/tcp to check for production listeners"
    return 0
  fi
  return 1
}
