#!/bin/sh
set -eu

# a `user:` in compose (the e2e stack runs as the host user) leaves nothing to set up, and no rights to do it with
if [ "$(id -u)" -ne 0 ]; then
    exec "$@"
fi

# the operator's value wins over the file, as it does for the app
root="${DOLOG_ROOT:-$(grep '^DOLOG_ROOT=' ".env.${STAGE}" | cut -d= -f2-)}"
mkdir -p "$root"
# a read-only mount inside the root (an .htpasswd, say) cannot be chowned, and does not need to be
chown -R bun:bun "$root" 2>/dev/null || true

# The docker socket is root:<group> 0660, and that group's id is the host's to choose. So bun joins
# whichever group owns the mounted socket; compose's group_add would not survive su-exec
socket="${DOLOG_DOCKER_SOCKET:-/var/run/docker.sock}"
if [ -S "$socket" ]; then
    gid=$(stat -c %g "$socket")
    group=$(getent group "$gid" | cut -d: -f1)
    if [ -z "$group" ]; then
        group=dockersock
        addgroup -g "$gid" "$group"
    fi
    id -nG bun | tr ' ' '\n' | grep -qx "$group" || addgroup bun "$group"
fi

exec su-exec bun "$@"
