import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : undefined;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || 'no-reply@swiftremit.example';

let transporter: nodemailer.Transporter | null = null;

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`Email disabled. Would send to ${to}: ${subject}`);
    return;
  }

  await tx.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}
