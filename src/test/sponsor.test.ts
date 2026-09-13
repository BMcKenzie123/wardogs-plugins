import test from 'node:test';
import assert from 'node:assert/strict';
import { isApprovedSponsorUrl, sponsorUrlProblem } from '../host/sponsor.ts';
import sponsorRotator from '../plugins/sponsor-rotator.ts';
import { sleep, startMockServer, waitFor } from './mock-server.ts';
import { bodyOf, makeHost, requestsTo } from './helpers.ts';

test('sponsor: whitelist accepts the approved hosts and their CDNs, rejects everything else', () => {
  for (const ok of [
    'https://i.ibb.co/m5R0qC2T/Server-Banner.png',
    'https://imgbb.com/x.png',
    'https://files.catbox.moe/abc123.png',
    'https://i.postimg.cc/xyz/banner.jpg',
    'https://postimg.cc/xyz',
  ])
    assert.equal(isApprovedSponsorUrl(ok), true, ok);
  for (const bad of [
    'http://i.ibb.co/m5R0qC2T/Server-Banner.png', // plain http
    'https://imgur.com/x.png',
    'https://evil.com/i.ibb.co/x.png', // host must match, not the path
    'https://i.ibb.co.evil.com/x.png',
    'not a url',
  ])
    assert.equal(isApprovedSponsorUrl(bad), false, bad);
  assert.equal(sponsorUrlProblem('https://i.ibb.co/x.png'), null);
  assert.match(sponsorUrlProblem('https://imgur.com/x.png') ?? '', /not on the server's image whitelist/);
});

test('sponsor-rotator: skips off-list URLs and only rotates through approved ones', async () => {
  const s = await startMockServer();
  const { host } = makeHost(s, [sponsorRotator], {
    'sponsor-rotator': {
      imageUrls: [
        'https://imgur.com/nope.png',
        'https://i.ibb.co/ok1.png',
        'https://files.catbox.moe/ok2.png',
      ],
      everyHours: 0.00005,
    },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'PUT', '/v1/sponsor').length >= 3, 3000, 'three rotations');
    const sent = requestsTo(s, 'PUT', '/v1/sponsor').map((r) => bodyOf<{ imageUrl: string }>(r).imageUrl);
    assert.deepEqual(sent.slice(0, 3), [
      'https://i.ibb.co/ok1.png',
      'https://files.catbox.moe/ok2.png',
      'https://i.ibb.co/ok1.png',
    ]);
    await sleep(50);
    assert.ok(!sent.includes('https://imgur.com/nope.png'), 'off-list URL never sent');
  } finally {
    await host.stop();
    await s.close();
  }
});
