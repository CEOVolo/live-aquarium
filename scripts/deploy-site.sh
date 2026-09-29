#!/usr/bin/env bash
# Publishes the standalone aquarium (dist/site) as static files: https://kd4.academy/aquarium/
# nginx serves /var/www/aquarium there (a location block in /etc/nginx/sites-available/odoo-demo).
# The folder is swapped as a whole, so a visitor never gets half an update.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@77.42.126.207}"
DIR="${DEPLOY_DIR:-/var/www/aquarium}"
cd "$(dirname "$0")/.."

node scripts/build-demo.mjs
# macOS tar would add Finder metadata that GNU tar on the server warns about
TAR_FLAGS=(); tar --version 2>/dev/null | grep -q bsdtar && TAR_FLAGS=(--no-mac-metadata --no-xattrs)
COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -czf dist/aquarium-site.tar.gz -C dist/site .
scp -q dist/aquarium-site.tar.gz "$HOST:/tmp/aquarium-site.tar.gz"
ssh "$HOST" "set -e
rm -rf '$DIR.new' && mkdir -p '$DIR.new'
tar -xzf /tmp/aquarium-site.tar.gz -C '$DIR.new' --no-same-owner
chmod -R a+rX '$DIR.new'
rm -rf '$DIR.old'
if [ -d '$DIR' ]; then mv '$DIR' '$DIR.old'; fi
mv '$DIR.new' '$DIR'
rm -rf '$DIR.old' /tmp/aquarium-site.tar.gz"
echo "Deployed: https://kd4.academy/aquarium/"
