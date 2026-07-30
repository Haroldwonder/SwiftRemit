import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : undefined;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || 'no-reply@swiftremit.example';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!host || !port) {
    console.warn('SMTP not configured; email will not be sent');
    return null as unknown as nodemailer.Transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  return transporter;
}

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
