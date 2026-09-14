# Security policy

Do not place real credentials in GitHub issues, discussions, screenshots, sample data, or pull requests.

For a suspected vulnerability, use GitHub private vulnerability reporting once the repository is published. Include the affected component, reproduction steps, impact, and a minimal proof of concept without exposing real prompts, assets, credentials, or member information.

Provider credentials belong only in the authenticated admin flow. The hosted deployment uses HTTPS, Cloudflare Worker Secrets, D1, and private R2 storage. Use independent high-entropy values for the token secret, encryption key, password pepper, bootstrap password, and asset-signing secret. Never rotate the encryption key without re-encrypting provider credentials, or the password pepper without resetting user passwords.
