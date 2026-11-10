import { Injectable, Logger } from '@nestjs/common';

/**
 * Odosielanie e-mailov cez Resend (https://resend.com).
 * Bez RESEND_API_KEY (dev/test) sa e-mail iba zaloguje — aplikácia
 * funguje rovnako, len sa nič neodošle.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey = process.env.RESEND_API_KEY;
  private readonly from = process.env.EMAIL_FROM ?? 'FK Košická Nová Ves <noreply@fkknv.sk>';

  async send(to: string[], subject: string, html: string, replyTo?: string): Promise<{ sent: boolean; reason?: string }> {
    if (to.length === 0) return { sent: false, reason: 'Rodičia nemajú v účte vyplnený e-mail.' };
    if (!this.apiKey) {
      this.logger.log(`[DEV e-mail] to=${to.join(',')} subject="${subject}"`);
      return { sent: false, reason: 'E-mail nie je nastavený: chýba RESEND_API_KEY v infra/.env na serveri.' };
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(`Resend vrátil ${response.status}: ${body}`);
        let detail = body.slice(0, 200);
        try {
          detail = (JSON.parse(body) as { message?: string }).message ?? detail;
        } catch {
          /* ponechaj surový text */
        }
        return { sent: false, reason: `Resend odmietol e-mail (${response.status}): ${detail}` };
      }
      return { sent: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`E-mail zlyhal: ${msg}`);
      return { sent: false, reason: `E-mail zlyhal: ${msg}` };
    }
  }
}
