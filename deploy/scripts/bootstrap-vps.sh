#!/usr/bin/env bash
# One-time (re-runnable) preparation of the Ubuntu 24.04 VPS "smartbook", run as root:
#
#   bootstrap-vps.sh <admin-pubkey-file> <ci-pubkey-file>
#
# - security updates + unattended-upgrades (security pocket only, no automatic reboot)
# - Docker Engine + compose plugin from Docker's official apt repository
# - Docker log rotation, journald size cap, 4 GB swap
# - user "deploy" (docker group, no sudo) owning /opt/smartbook; admin key + CI key
#   (the CI key is restricted: no pty, no forwarding)
# - UFW: only SSH, 80, 443 open; fail2ban for sshd
# - cron: daily backup, 5-minute health check
#
# It does NOT change the hostname (must stay "smartbook") and does NOT touch sshd's
# authentication settings - see harden-ssh.sh, run only after key logins are verified.
set -Eeuo pipefail

admin_key_file="${1:?usage: bootstrap-vps.sh <admin-pubkey-file> <ci-pubkey-file>}"
ci_key_file="${2:?usage: bootstrap-vps.sh <admin-pubkey-file> <ci-pubkey-file>}"
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ "$(hostname)" == "smartbook" ]] || echo "WARNING: hostname is '$(hostname)', expected 'smartbook' (left unchanged)" >&2

APP_DIR=/opt/smartbook
export DEBIAN_FRONTEND=noninteractive

echo "== packages and security updates"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg jq ufw fail2ban unattended-upgrades cron openssl

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat >/etc/apt/apt.conf.d/52smartbook-unattended <<'EOF'
// security updates only (the stock 50unattended-upgrades origins); never reboot on our own
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
EOF
systemctl enable --now unattended-upgrades
# apply pending security updates now (same policy as the nightly run)
unattended-upgrade

echo "== docker engine"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
EOF
  systemctl restart docker
fi
systemctl enable docker containerd

echo "== journald cap"
mkdir -p /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/smartbook.conf <<'EOF'
[Journal]
SystemMaxUse=500M
EOF
systemctl restart systemd-journald

echo "== swap"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/99-smartbook.conf
sysctl -q --system

echo "== deploy user"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "SmartBook deploy" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
{
  cat "$admin_key_file"
  printf 'restrict %s\n' "$(cat "$ci_key_file")"
} >/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
# root keeps working with the admin key (needed before harden-ssh.sh turns passwords off)
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys
grep -qxF "$(cat "$admin_key_file")" /root/.ssh/authorized_keys || cat "$admin_key_file" >>/root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy "$APP_DIR" "$APP_DIR/state" "$APP_DIR/secrets" "$APP_DIR/backups"
chmod 700 "$APP_DIR/secrets" "$APP_DIR/backups"

echo "== firewall"
ssh_port="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
ssh_port="${ssh_port:-22}"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit "$ssh_port/tcp" comment 'ssh' >/dev/null
ufw allow 80/tcp comment 'http (caddy)' >/dev/null
ufw allow 443/tcp comment 'https (caddy)' >/dev/null
ufw allow 443/udp comment 'http3 (caddy)' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

echo "== fail2ban"
cat >/etc/fail2ban/jail.d/smartbook.local <<EOF
[sshd]
enabled = true
port = $ssh_port
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "== cron"
cat >/etc/cron.d/smartbook <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# 02:30 server time (the VPS clock is Asia/Bangkok, UTC+7 = Vietnam time)
30 2 * * * deploy [ -x $APP_DIR/deploy/scripts/backup.sh ] && $APP_DIR/deploy/scripts/backup.sh >>$APP_DIR/state/backup.log 2>&1
*/5 * * * * deploy [ -x $APP_DIR/deploy/scripts/healthcheck.sh ] && [ -f $APP_DIR/state/release.env ] && $APP_DIR/deploy/scripts/healthcheck.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/smartbook

echo "== done: $(docker --version); $(docker compose version)"
