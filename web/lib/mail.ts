import nodemailer from "nodemailer";

export const mailConfigured = () => Boolean(process.env.SMTP_URL);

/** Envoie un email par le serveur SMTP_URL (smtp://utilisateur:motdepasse@hôte:port). Faux si rien n'est configuré. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!process.env.SMTP_URL) return false;
  await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from: process.env.MAIL_FROM || "ClipForge <no-reply@localhost>", to, subject, text });
  return true;
}
