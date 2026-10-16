# Google Ads connection validation

This stage permits OAuth consent, account discovery and linking accounts to clients.
Campaign creation remains limited to Meta WhatsApp. Keep both publication and
activation gates disabled while validating the providers.

## Credentials

Configure these server-only variables in the ignored `.env.vercel.local` and Vercel
Production environment:

- `GOOGLE_CLIENT_ID`: a Google Cloud OAuth client of type Web application.
- `GOOGLE_CLIENT_SECRET`: its secret.
- API access is granted to the Google Cloud project owning the OAuth client. Developer tokens were retired on September 9, 2026; the connector neither requires nor sends them.
- `GOOGLE_ADS_API_VERSION=v25`: independent of the Meta API version.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: optional ten-digit manager/MCC ID. When provided,
  account discovery is restricted to this hierarchy; otherwise discover all directly
  authorized accounts and expand the accessible managers.

Enable the Google Ads API in the Cloud project associated with OAuth credentials.
Configure consent/audience and add the authorizing user as a test user if needed.
Register this exact authorized redirect URI:
`https://autocampaign-tan.vercel.app/api/oauth/google/callback`.
No service-account key or manually generated refresh token is needed for this flow.
Tokens are obtained by server-side code exchange and stored encrypted. Missing
refresh tokens require granting offline consent again. Revoked/expired grants require
reconnection. API project/token access levels must permit the target account type.

## Acceptance

1. Log into the production root URL (not `/demo`) as administrator.
2. Choose a client and use Connections > Connect Google.
3. Consent with a Google user that has access to the intended Ads accounts.
4. Select accounts and verify ID, name, currency and timezone against Google Ads.
5. Link only the intended client's account. Confirm it cannot be linked to another client.
6. Verify refresh-token renewal and revoked-access handling during integration testing.

OAuth success alone does not certify Google Cloud project API access. Real validation
requires a successful `customers:listAccessibleCustomers` call followed by account
metadata reads. These reads create no ads. Discovery does not send `login-customer-id`;
queries through a manager use that manager as context. No tokens are exposed in the UI.

References:
- https://developers.google.com/google-ads/api/docs/account-management/listing-accounts
- https://developers.google.com/google-ads/api/rest/auth
- https://developers.google.com/identity/protocols/oauth2/web-server

The authorized redirect URI must exactly match `https://autocampaign-tan.vercel.app/api/oauth/google/callback` for production. OAuth credentials remain server-only. Configuration and a successful authorization redirect do not prove Google Ads access: the account owner must complete consent, then account discovery must succeed. API enablement and production access are managed in the same Google Cloud project.

Migration reference: https://developers.google.com/google-ads/api/docs/api-policy/developer-token
