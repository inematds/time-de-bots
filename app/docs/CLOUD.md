# Optional cloud computer

The source in `packages/cloud` runs a browser/computer service in an account you control. Cloning this repository does not deploy it or connect to anyone else's account.

## Prepare

1. Review the Cloudflare Sandbox and Browser Rendering requirements and pricing for your account.
2. Install dependencies inside `packages/cloud`.
3. Authenticate Wrangler to your own account and choose a unique Worker name in `wrangler.jsonc`.
4. Generate strong independent values for `GRATIS_ENROLLMENT_TOKEN` and `GRATIS_TOKEN_SECRET`, then store them with Wrangler secret commands. Do not commit their values.
5. Run type checks, unit tests and a dry-run deployment before deploying.

```sh
cd packages/cloud
npm ci
npm run typecheck
npx vitest run
npm run deploy:dry
npx wrangler secret put GRATIS_ENROLLMENT_TOKEN
npx wrangler secret put GRATIS_TOKEN_SECRET
npm run deploy
```

Read the authentication and enrollment handlers in `src/index.ts` and `src/http.ts` before provisioning desktop credentials. Use a scoped desktop token, not the signing secret. Configure the endpoint and token in Gratis Settings. No account ID, token or production endpoint is supplied here.

## Operate

The cloud computer is separate from the desktop filesystem. Use Files to save deliverables you need to keep. Take control pauses the bot while you use the browser, and Give control back resumes from a fresh observation. Stopping the computer can discard temporary browser state.

Cloud resources and usage may incur charges. Monitor them in your own dashboard, set appropriate limits, and remove unused deployments. This repository does not promise a specific monthly hosting cost or indefinite task availability.
