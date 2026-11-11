# Reporting security issues

Use GitHub's private vulnerability reporting for security-sensitive reports.
For ordinary bugs, open an issue with a minimal reproduction and redacted logs.

Never include API keys, Google authorization codes, refresh tokens, AGY keyring
data, login URLs, private request bodies or conversation transcripts in a public
issue or pull request.

The API defaults to loopback binding and requires a private Bearer key. Keep
credentials and session files outside Git. When deploying across machines,
configure an authenticated, trusted network path.
