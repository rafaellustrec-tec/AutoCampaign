import test from 'node:test';
import assert from 'node:assert/strict';
import { requireActivationEnabled } from '../src/lib/publication-policy';
import { executePublication } from '../src/lib/publishers';

test('activation fails closed even when publication is enabled; queued jobs cannot bypass the gate', async () => {
  const previous = process.env.ADS_ACTIVATION_ENABLED;
  const publication = process.env.ADS_PUBLISH_ENABLED;
  try {
    process.env.ADS_PUBLISH_ENABLED = 'true';
    for (const value of [undefined, 'false', '', 'TRUE', '1']) {
      if (value === undefined) delete process.env.ADS_ACTIVATION_ENABLED;
      else process.env.ADS_ACTIVATION_ENABLED = value;
      assert.throws(() => requireActivationEnabled('activate'), /Ativação bloqueada/);
      assert.doesNotThrow(() => requireActivationEnabled('create'));
      await assert.rejects(executePublication({id:'unused',client_id:'unused',campaign_id:'unused',version:1,kind:'activate',lease_token:'unused'}), /Ativação bloqueada/);
    }
    process.env.ADS_ACTIVATION_ENABLED = 'true';
    assert.doesNotThrow(() => requireActivationEnabled('activate'));
  } finally {
    if (previous === undefined) delete process.env.ADS_ACTIVATION_ENABLED;
    else process.env.ADS_ACTIVATION_ENABLED = previous;
    if (publication === undefined) delete process.env.ADS_PUBLISH_ENABLED;
    else process.env.ADS_PUBLISH_ENABLED = publication;
  }
});
