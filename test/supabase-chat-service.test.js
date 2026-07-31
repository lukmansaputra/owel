const test = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseChatService } = require('../supabase-chat-service');

test('menerjemahkan hasil RPC matching Supabase', async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'match_user');
    assert.deepEqual(args, { p_user_id: 123 });
    return { data: [{ status: 'matched', partner_id: 456 }], error: null };
  } };
  const chats = new SupabaseChatService('https://example.supabase.co', 'test-key', client);
  assert.deepEqual(await chats.requestMatch(123), { status: 'matched', partnerId: 456 });
});

test('menerjemahkan hasil report Supabase', async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'report_user');
    assert.deepEqual(args, { p_reporter_id: 123, p_reason: 'spam' });
    return { data: [{ status: 'ended', partner_id: 456, report_id: '11111111-1111-4111-8111-111111111111' }], error: null };
  } };
  const chats = new SupabaseChatService('https://example.supabase.co', 'test-key', client);
  assert.deepEqual(await chats.report(123, 'spam'), { status: 'ended', partnerId: 456, reportId: '11111111-1111-4111-8111-111111111111' });
});

test('memperpanjang membership premium dari masa aktif yang masih tersisa', async () => {
  const chats = new SupabaseChatService('https://example.supabase.co', 'test-key', {});
  const existingUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  chats.ensureProfile = async () => ({ premium_until: existingUntil });
  chats.updateProfile = async (_userId, changes) => changes;

  const result = await chats.activatePremium(123, 30);
  assert.equal(result.premium_plan, 'monthly');
  assert.ok(new Date(result.premium_until).getTime() >= new Date(existingUntil).getTime() + 30 * 24 * 60 * 60 * 1000 - 10);
});

test('menyimpan dan membaca tujuan reply pesan anonim', async () => {
  let saved;
  const client = {
    from: () => ({
      upsert: async (value) => {
        saved = value;
        return { error: null };
      },
      select: () => ({
        eq() { return this; },
        maybeSingle: async () => ({ data: { sender_id: 123, sender_message_id: 45 }, error: null }),
      }),
    }),
  };
  const chats = new SupabaseChatService('https://example.supabase.co', 'test-key', client);
  await chats.saveMessageLink(123, 45, 456, 67);
  assert.deepEqual(saved, {
    sender_id: 123,
    sender_message_id: 45,
    recipient_id: 456,
    recipient_message_id: 67,
  });
  assert.deepEqual(await chats.getReplyTarget(456, 67), { userId: 123, messageId: 45 });
});
