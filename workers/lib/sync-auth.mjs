const encoder = new TextEncoder();

function constantTimeEqual(left, right) {
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function validSyncToken(header, secret) {
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    typeof header !== "string"
  ) {
    return false;
  }
  const expected = await sha256("Bearer " + secret);
  const actual = await sha256(header);
  return constantTimeEqual(actual, expected);
}
