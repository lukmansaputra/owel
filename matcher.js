class AnonymousChatService {
  constructor() {
    this.queue = [];
    this.sessions = new Map();
    this.partners = new Map();
    this.blocks = new Map();
    this.reports = [];
  }

  isBlocked(userId, candidateId) {
    return this.blocks.get(userId)?.has(candidateId) || false;
  }

  findPartner(userId) {
    const index = this.queue.findIndex((candidateId) =>
      candidateId !== userId &&
      !this.isBlocked(userId, candidateId) &&
      !this.isBlocked(candidateId, userId),
    );

    if (index === -1) return null;
    return this.queue.splice(index, 1)[0];
  }

  requestMatch(userId) {
    this.removeFromQueue(userId);
    if (this.partners.has(userId)) return { status: 'already_matched', partnerId: this.partners.get(userId) };

    const partnerId = this.findPartner(userId);
    if (!partnerId) {
      this.queue.push(userId);
      return { status: 'queued' };
    }

    const session = { id: `${userId}:${partnerId}:${Date.now()}`, users: [userId, partnerId], startedAt: new Date().toISOString() };
    this.sessions.set(session.id, session);
    this.partners.set(userId, partnerId);
    this.partners.set(partnerId, userId);
    return { status: 'matched', partnerId, session };
  }

  removeFromQueue(userId) {
    this.queue = this.queue.filter((id) => id !== userId);
  }

  endChat(userId) {
    const partnerId = this.partners.get(userId);
    this.removeFromQueue(userId);
    if (!partnerId) return { status: 'not_matched' };

    this.partners.delete(userId);
    this.partners.delete(partnerId);
    for (const [id, session] of this.sessions) {
      if (session.users.includes(userId)) this.sessions.delete(id);
    }
    return { status: 'ended', partnerId };
  }

  report(userId, reason = 'Tidak ada alasan') {
    const partnerId = this.partners.get(userId);
    if (!partnerId) return { status: 'not_matched' };

    if (!this.blocks.has(userId)) this.blocks.set(userId, new Set());
    this.blocks.get(userId).add(partnerId);
    this.reports.push({ reporterId: userId, reportedId: partnerId, reason, createdAt: new Date().toISOString() });
    return { ...this.endChat(userId), reportedId: partnerId };
  }

  getPartner(userId) {
    return this.partners.get(userId) || null;
  }
}

module.exports = { AnonymousChatService };
