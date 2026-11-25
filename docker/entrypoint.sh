#!/bin/sh
# Start Lectern as the user that owns your library folders.
#
# PUID and PGID pick that user (like most self-hosted apps): Lectern writes
# books into your libraries, so it must be allowed to create folders there.
# Defaults: 1000:1000. Find yours with `id` on the host.
#
# If the container was started as a non-root user already (compose `user:`),
# Lectern simply runs as that user.
set -e

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  # Lectern's own data folder (database and cover cache) must be its own.
  mkdir -p "${DATA_DIR:-/data}"
  chown -R "$PUID:$PGID" "${DATA_DIR:-/data}"
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi

exec "$@"
