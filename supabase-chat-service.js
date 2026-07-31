const { createClient } = require('@supabase/supabase-js');

function assertNoError(error) {
  if (error) throw new Error(`Supabase error: ${error.message}`);
}

class SupabaseChatService {
  constructor(url, serviceRoleKey, client) {
    if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diatur.');
    this.client = client || createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async requestMatch(userId) {
    const { data, error } = await this.client.rpc('match_user', { p_user_id: userId });
    assertNoError(error);
    const result = data[0];
    return { status: result.status, partnerId: result.partner_id || null };
  }

  async getProfile(userId) {
    const { data, error } = await this.client
      .from('users')
      .select('telegram_id, gender, profile_step, profile_completed_at, premium_until, premium_plan, match_gender_preference, media_filter_enabled')
      .eq('telegram_id', userId)
      .maybeSingle();
    assertNoError(error);
    return data;
  }

  async ensureProfile(userId) {
    const { error } = await this.client
      .from('users')
      .upsert({ telegram_id: userId }, { onConflict: 'telegram_id', ignoreDuplicates: true });
    assertNoError(error);
    return this.getProfile(userId);
  }

  async updateProfile(userId, changes) {
    const { data, error } = await this.client
      .from('users')
      .update(changes)
      .eq('telegram_id', userId)
      .select('telegram_id, gender, profile_step, profile_completed_at, premium_until, premium_plan, match_gender_preference, media_filter_enabled')
      .single();
    assertNoError(error);
    return data;
  }

  async activatePremium(userId, durationDays, plan = 'monthly') {
    const profile = await this.ensureProfile(userId);
    const currentUntil = profile.premium_until ? new Date(profile.premium_until) : null;
    const startsAt = currentUntil && currentUntil > new Date() ? currentUntil : new Date();
    const premiumUntil = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    return this.updateProfile(userId, { premium_until: premiumUntil, premium_plan: plan });
  }

  async reportEndedChat(reporterId, reportedId, reason) {
    const { data, error } = await this.client.rpc('report_ended_chat', {
      p_reporter_id: reporterId,
      p_reported_id: reportedId,
      p_reason: reason,
    });
    assertNoError(error);
    const result = data[0];
    return { status: result.status, reportId: result.report_id || null };
  }

  async blockReportedUser(userId, reportId) {
    const { data, error } = await this.client.rpc('block_reported_user', { p_reporter_id: userId, p_report_id: reportId });
    assertNoError(error);
    return data === true;
  }

  async endChat(userId) {
    const { data, error } = await this.client.rpc('end_chat', { p_user_id: userId, p_reason: 'ended' });
    assertNoError(error);
    const result = data[0];
    return { status: result.status, partnerId: result.partner_id || null };
  }

  async report(userId, reason = 'Tidak ada alasan') {
    const { data, error } = await this.client.rpc('report_user', { p_reporter_id: userId, p_reason: reason });
    assertNoError(error);
    const result = data[0];
    return { status: result.status, partnerId: result.partner_id || null, reportId: result.report_id || null };
  }

  async getPartner(userId) {
    const { data, error } = await this.client
      .from('chat_sessions')
      .select('user_one, user_two')
      .is('ended_at', null)
      .or(`user_one.eq.${userId},user_two.eq.${userId}`)
      .limit(1)
      .maybeSingle();
    assertNoError(error);
    if (!data) return null;
    return data.user_one === userId ? data.user_two : data.user_one;
  }

  async saveMessageLink(senderId, senderMessageId, recipientId, recipientMessageId) {
    const { error } = await this.client
      .from('chat_message_links')
      .upsert({
        sender_id: senderId,
        sender_message_id: senderMessageId,
        recipient_id: recipientId,
        recipient_message_id: recipientMessageId,
      }, { onConflict: 'sender_id,sender_message_id' });
    assertNoError(error);
  }

  async getReplyTarget(recipientId, recipientMessageId) {
    const { data, error } = await this.client
      .from('chat_message_links')
      .select('sender_id, sender_message_id')
      .eq('recipient_id', recipientId)
      .eq('recipient_message_id', recipientMessageId)
      .maybeSingle();
    assertNoError(error);
    return data
      ? { userId: data.sender_id, messageId: data.sender_message_id }
      : null;
  }

  async listReports() {
    const { data, error } = await this.client.from('reports').select('id, reporter_id, reported_id, reason, created_at').order('created_at', { ascending: false }).limit(100);
    assertNoError(error);
    return data;
  }

  async listGlobalBlocks() {
    const { data, error } = await this.client.from('global_blocks').select('telegram_id, note, blocked_at').order('blocked_at', { ascending: false });
    assertNoError(error);
    return data;
  }

  async setGlobalBlock(userId, note = '') {
    const { error } = await this.client.from('global_blocks').upsert({ telegram_id: userId, note }, { onConflict: 'telegram_id' });
    assertNoError(error);
  }

  async removeGlobalBlock(userId) {
    const { error } = await this.client.from('global_blocks').delete().eq('telegram_id', userId);
    assertNoError(error);
  }

  async recordEvidence(userId, kind, text = null, fileUniqueId = null, telegramFileId = null) {
    const { error } = await this.client.rpc('record_chat_evidence', { p_sender_id: userId, p_kind: kind, p_text: text, p_file_unique_id: fileUniqueId, p_telegram_file_id: telegramFileId });
    assertNoError(error);
  }

  async listModerationCases() {
    const { data, error } = await this.client.from('moderation_cases').select('id, reported_id, status, severity, admin_note, created_at, reports(reason, reporter_id)').order('created_at', { ascending: false }).limit(100);
    assertNoError(error);
    return data;
  }

  async getCaseEvidence(caseId) {
    const { data, error } = await this.client.rpc('get_case_evidence', { p_case_id: caseId });
    assertNoError(error);
    return data;
  }

  async getEvidenceMedia(evidenceId) {
    const { data, error } = await this.client.from('chat_evidence').select('telegram_file_id, kind').eq('id', evidenceId).maybeSingle();
    assertNoError(error);
    return data;
  }

  async updateModerationCase(caseId, status, adminNote = '') {
    const { error } = await this.client.from('moderation_cases').update({ status, admin_note: adminNote, actioned_at: new Date().toISOString() }).eq('id', caseId);
    assertNoError(error);
  }

  async suspendFromCase(caseId, hours, adminNote) {
    const { data, error } = await this.client.from('moderation_cases').select('reported_id').eq('id', caseId).single();
    assertNoError(error);
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { error: blockError } = await this.client.from('global_blocks').upsert({ telegram_id: data.reported_id, note: adminNote, expires_at: expiresAt }, { onConflict: 'telegram_id' });
    assertNoError(blockError);
    await this.updateModerationCase(caseId, 'suspended', adminNote);
  }
}

module.exports = { SupabaseChatService };
