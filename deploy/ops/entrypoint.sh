#!/bin/sh
# busybox crond starts jobs with an empty environment, so hand the container's
# settings to the job scripts through a file only root can read.
set -eu
umask 077
export -p > /ops/env.sh
exec crond -f -l 6
