import test from "node:test";
import assert from "node:assert/strict";
import { validSyncToken } from "../workers/lib/sync-auth.mjs";

test("background sync requires a matching server-only trigger secret", async () => {
  const secret = "a".repeat(64);
  assert.equal(await validSyncToken("Bearer " + secret, secret), true);
  for (const header of [undefined, "", "Bearer wrong", secret, "Basic " + secret]) {
    assert.equal(await validSyncToken(header, secret), false);
  }
  assert.equal(await validSyncToken("Bearer short", "short"), false);
  assert.equal(await validSyncToken("Bearer " + secret, undefined), false);
});
