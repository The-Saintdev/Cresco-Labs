# Cresco Labs Admin Mobile

The private administration app. It is a separate mobile client with its own authentication and permissions.

- Create, approve, suspend, and reset team accounts
- Add and configure models
- Set model type and pricing rules
- Enable or disable models
- Track total usage, spend, credits, prompts, calls, errors, and per-model costs

Provider credentials are submitted to the one backend over an authenticated connection, encrypted before D1 persistence, and never stored in the mobile bundle. Set `EXPO_PUBLIC_API_URL` to the deployed Worker URL before an EAS build.
