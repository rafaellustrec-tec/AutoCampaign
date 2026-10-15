# Meta WhatsApp pilot

Configure server-only `META_APP_ID`, `META_APP_SECRET`, `META_API_VERSION` and
`META_LOGIN_CONFIG_ID`. Never prefix these with `NEXT_PUBLIC_` or commit secrets.
The Business Login configuration must issue an expiring system-user token with
`ads_management`; ad accounts are selected in Meta's consent flow.

Register the exact production callback in Meta:
`https://autocampaign-tan.vercel.app/api/oauth/meta/callback`.
The browser uses `config_id`, `response_type=code` and an opaque single-use state,
bound to the initiating administrator and client, valid for ten minutes.
The server exchanges the code and inspects the resulting token with `debug_token`:
app ID, system-user type, validity, permission and expiration must be confirmed.
There is no personal-user long-lived token exchange or assumed 60-day expiration.
Expired credentials require reconnecting. Stored credentials are encrypted.

`ADS_PUBLISH_ENABLED=false` blocks creation and publication globally.
`ADS_ACTIVATION_ENABLED=false` independently blocks activation before approval/job
creation, during job validation, at publisher entry and before each Meta ACTIVE
request. Missing or non-literal `true` values also block activation. To test paused
creation later, enable only publication; keep activation disabled. Existing role,
client, version and approval checks remain required even when both gates are on.

Login alone does not certify Page/WhatsApp asset access or advertising eligibility.
Validate the selected account, Page and linked phone before approving paused creation.
No real ad is created by unit/integration tests; provider responses are simulated.
Completing Meta consent and checking real account reads requires an authorized user.
