import nodemailer from 'nodemailer';
import { env } from './config.js';

let transporter;

function getTransporter() {
  if (!transporter) {
    const port = Number(env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

// With MAIL_DEV_LOG=1 mail is printed to the console instead of sent (local dev without SMTP).
export async function sendMail({ to, subject, text }) {
  if (env.MAIL_DEV_LOG === '1') {
    console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    return { messageId: 'dev-log', response: 'logged to console' };
  }
  return getTransporter().sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to,
    subject,
    text,
  });
}
