#!/usr/bin/env bash
# Turn off SSH password logins (keys only; root only with a key). Run as root, and only
# after confirming in a SEPARATE session that `ssh -i <key> deploy@...` and
# `ssh -i <key> root@...` both work. Keep the current session open until a fresh login
# succeeds afterwards. The VPS provider's web console stays available as a fallback.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ -s /root/.ssh/authorized_keys && -s /home/deploy/.ssh/authorized_keys ]] \
  || { echo "authorized_keys missing for root or deploy - refusing" >&2; exit 1; }

# sshd uses the FIRST value it reads and includes sshd_config.d/*.conf in name order, so
# this must sort before 50-cloud-init.conf (which sets PasswordAuthentication yes).
cat >/etc/ssh/sshd_config.d/00-smartbook-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 4
X11Forwarding no
EOF
sshd -t
systemctl restart ssh
sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) '
