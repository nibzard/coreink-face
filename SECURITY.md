# Security

Report vulnerabilities through GitHub's **Report a vulnerability** feature
when enabled, or contact the maintainer through an existing private channel.
If neither is available, open an issue requesting a private contact without
including vulnerability details. Never post credentials in issues. Include the
affected version, reproduction steps using synthetic data, and expected impact
in the private report.

This template uses deployment-wide writer and reader tokens. A reader can read
all device IDs in that deployment. Add per-device authorization and tenant
isolation before offering a multi-user service. Keep provider credentials on
the server and rotate exposed tokens with Wrangler.

Local `.dev.vars`, `.env`, deployment secret files, and `.wrangler` storage must
remain untracked. Display decisions are presentation data, not authorization
to execute work. Review the README's deployment and authentication contracts
before exposing an installation to untrusted clients.
