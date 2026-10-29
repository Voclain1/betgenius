import assert from 'node:assert/strict';
import { kickoffLabel, kickoffTime, footballDayKey } from '../src/lib/footballTime';
for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
  process.env.TZ = zone;
  assert.equal(kickoffTime('2026-10-29T18:30:00Z'), '19:30 WAT');
  assert.equal(kickoffLabel('2026-10-29T18:30:00Z'), 'Thu 19:30 WAT');
  assert.equal(footballDayKey('2026-10-29T23:30:00Z'), '30/10/2026');
}
assert.equal(kickoffTime('invalid'), 'Time unavailable');
console.log('Football times: host timezone independence and WAT midnight rollover passed');
