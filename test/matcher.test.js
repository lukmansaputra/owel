const test = require('node:test');
const assert = require('node:assert/strict');
const { AnonymousChatService } = require('../matcher');

test('memasangkan dua pengguna yang mengantre dan meneruskan status pasangan', () => {
  const chats = new AnonymousChatService();
  assert.equal(chats.requestMatch(1).status, 'queued');
  const result = chats.requestMatch(2);
  assert.equal(result.status, 'matched');
  assert.equal(chats.getPartner(1), 2);
  assert.equal(chats.getPartner(2), 1);
});

test('laporan menutup chat dan mencegah pasangan yang sama untuk dipasangkan lagi', () => {
  const chats = new AnonymousChatService();
  chats.requestMatch(1);
  chats.requestMatch(2);
  const report = chats.report(1, 'spam');
  assert.equal(report.status, 'ended');
  assert.equal(chats.isBlocked(1, 2), true);
  assert.equal(chats.getPartner(1), null);
  assert.equal(chats.requestMatch(1).status, 'queued');
  assert.equal(chats.requestMatch(2).status, 'queued');
});
