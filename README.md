# SSH Console

Web SSH gateway: https://ssh.benjaminberger.at - SSH in the browser (port 443), for networks that block outgoing port 22.

- Node 22, `express`, `ws`, `ssh2`; frontend: xterm.js (served locally, no CDN). Plain HTML UI.
- First login: email + setup code (`/var/lib/webconsole/setup-code.txt`) + password, then set up 2FA (TOTP).
- Login: password; the **2FA code is only required if the request does not come from Austria** (Cloudflare `CF-IPCountry` -> nginx -> `X-Country`; if the header is missing, 2FA is required).
- SSH passwords/keys are never stored; host keys are remembered per host:port (TOFU, warning on change).

## Operation
    systemctl status webconsole        journalctl -u webconsole -f
    sudo systemctl restart webconsole  # logs out all browsers, ends SSH sessions
    sudo cat /var/lib/webconsole/setup-code.txt   # only while no account exists

Data: `/var/lib/webconsole/data.json` (0600, user `webconsole`).
Forgot password/2FA: stop the service, delete `data.json` (or set `"user": null`), start it -> new setup code.
Configuration: `deploy/webconsole.service` (environment variables), `deploy/ssh.benjaminberger.at.nginx` + `deploy/console-proxy-headers.conf` (to `/etc/nginx/sites-enabled/` and `/etc/nginx/snippets/`).

## Test
    node test/e2e.js <baseUrl> <setup-code-file> <ssh-port> <private-key>   # against a fresh instance with its own DATA_DIR/PORT/PUBLIC_ORIGIN
