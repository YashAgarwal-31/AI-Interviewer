import { Resend } from 'resend';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not specified' : date.toLocaleString();
};

class EmailService {
  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || '';
    this.resend = this.apiKey ? new Resend(this.apiKey) : null;
    this.fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  }

  isConfigured() {
    return Boolean(this.resend && this.fromEmail);
  }

  async sendSessionInvite(candidateData, sessionUrl, sessionDetails) {
    if (!this.isConfigured()) {
      return { success: false, error: 'Email service is not configured. Set RESEND_API_KEY and FROM_EMAIL.' };
    }

    const email = candidateData?.email;
    if (!email) return { success: false, error: 'Candidate email is required' };

    try {
      const template = this.generateSessionEmailTemplate(
        candidateData?.name || 'Candidate',
        sessionUrl,
        sessionDetails || {}
      );
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: [email],
        subject: 'Your secure AI interview link',
        html: template.html,
        text: template.text,
        tags: [{ name: 'category', value: 'interview-session' }]
      });

      if (result.error) {
        return { success: false, error: result.error.message || 'Resend rejected the email' };
      }

      return {
        success: true,
        messageId: result.data?.id || null,
        recipient: email,
        sessionUrl
      };
    } catch (error) {
      console.error('Failed to send interview invite:', error);
      return { success: false, error: error.message, recipient: email };
    }
  }

  generateSessionEmailTemplate(candidateName, sessionUrl, sessionDetails) {
    const safeName = escapeHtml(candidateName);
    const safeUrl = escapeHtml(sessionUrl);
    const startTime = formatDate(sessionDetails.startTime);
    const endTime = formatDate(sessionDetails.endTime);
    const duration = Number(sessionDetails.duration) || 60;

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#1f2937">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="padding:28px;background:#111827;color:#fff"><h1 style="margin:0;font-size:24px">AI Technical Interview</h1></div>
    <div style="padding:28px">
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>Your interview session is ready. Use the secure link below during your scheduled access window.</p>
      <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:20px 0">
        <p style="margin:4px 0"><strong>Start:</strong> ${escapeHtml(startTime)}</p>
        <p style="margin:4px 0"><strong>End:</strong> ${escapeHtml(endTime)}</p>
        <p style="margin:4px 0"><strong>Duration:</strong> ${duration} minutes</p>
      </div>
      <p style="text-align:center;margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:700">Open interview</a></p>
      <p style="font-size:13px;color:#6b7280">This link contains a private access token. Do not forward or share it. If a new invite is issued, older links may stop working.</p>
    </div>
  </div>
</body>
</html>`;

    const text = `AI Technical Interview\n\nHi ${candidateName},\n\nYour interview session is ready.\nStart: ${startTime}\nEnd: ${endTime}\nDuration: ${duration} minutes\n\nSecure interview link: ${sessionUrl}\n\nDo not share this link. If a new invite is issued, older links may stop working.`;
    return { html, text };
  }

  async sendSessionReminder(candidateData, sessionUrl, sessionDetails, minutesUntilStart = 15) {
    if (!this.isConfigured()) {
      return { success: false, error: 'Email service is not configured. Set RESEND_API_KEY and FROM_EMAIL.' };
    }

    const email = candidateData?.email;
    if (!email) return { success: false, error: 'Candidate email is required' };

    try {
      const safeName = escapeHtml(candidateData?.name || 'Candidate');
      const safeUrl = escapeHtml(sessionUrl);
      const start = escapeHtml(formatDate(sessionDetails?.startTime));
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: [email],
        subject: `Interview reminder: starts in ${Number(minutesUntilStart) || 15} minutes`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Interview reminder</h2><p>Hi <strong>${safeName}</strong>, your interview starts at ${start}.</p><p><a href="${safeUrl}">Open your secure interview link</a></p><p style="font-size:13px;color:#6b7280">Do not share this link.</p></div>`,
        text: `Hi ${candidateData?.name || 'Candidate'}, your interview starts at ${formatDate(sessionDetails?.startTime)}. Secure link: ${sessionUrl}`,
        tags: [{ name: 'category', value: 'session-reminder' }]
      });

      if (result.error) return { success: false, error: result.error.message || 'Resend rejected the email' };
      return { success: true, messageId: result.data?.id || null, recipient: email };
    } catch (error) {
      console.error('Failed to send interview reminder:', error);
      return { success: false, error: error.message, recipient: email };
    }
  }

  async testEmailConfiguration() {
    return {
      success: this.isConfigured(),
      configured: this.isConfigured(),
      fromEmail: this.fromEmail,
      message: this.isConfigured()
        ? 'Email service is configured'
        : 'Set RESEND_API_KEY and FROM_EMAIL before sending email'
    };
  }
}

export default new EmailService();
