import { useEnv } from './helpers/env/index.js';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import sg from 'nodemailer-sendgrid';
import mg from 'nodemailer-mailgun-transport';
import { useLogger } from './helpers/logger/index.js';
import { getConfigFromEnv } from './helpers/utils/get-config-from-env.js';

let transporter: Transporter;

export default function getMailer(): Transporter {
	if (transporter) return transporter;

	const env = useEnv();
	const logger = useLogger();

	const transportName = (env['EMAIL_TRANSPORT'] as string).toLowerCase();
	switch (transportName) {
		case 'development':
			transporter = nodemailer.createTransport({
				streamTransport: true,
				newline: 'unix',
				buffer: true,
			});
			transporter.use('compile', (mail, callback) => {
				console.log('Sending mail with the following details:');
				console.log('From:', mail.data.from);
				console.log('To:', mail.data.to);
				console.log('Subject:', mail.data.subject);
				console.log('Text:', mail.data.text);
				console.log('data:', mail.data);
				callback();
			});
			break;
		case 'sendmail':
			transporter = nodemailer.createTransport({
				sendmail: true,
				newline: (env['EMAIL_SENDMAIL_NEW_LINE'] as string) || 'unix',
				path: (env['EMAIL_SENDMAIL_PATH'] as string) || '/usr/sbin/sendmail',
			});
			break;
		case 'ses':
			const aws = require('@aws-sdk/client-ses');
			const sesOptions: Record<string, unknown> = getConfigFromEnv('EMAIL_SES_');

			const ses = new aws.SES(sesOptions);

			transporter = nodemailer.createTransport({
				SES: { ses, aws },
			} as Record<string, unknown>);
			break;
		case 'smtp':
			let auth: boolean | { user?: string; pass?: string } = false;

			if (env['EMAIL_SMTP_USER'] || env['EMAIL_SMTP_PASSWORD']) {
				auth = {
					user: env['EMAIL_SMTP_USER'] as string,
					pass: env['EMAIL_SMTP_PASSWORD'] as string,
				};
			}

			const tls: Record<string, unknown> = getConfigFromEnv('EMAIL_SMTP_TLS_');

			transporter = nodemailer.createTransport({
				name: env['EMAIL_SMTP_NAME'],
				pool: env['EMAIL_SMTP_POOL'],
				host: env['EMAIL_SMTP_HOST'],
				port: env['EMAIL_SMTP_PORT'],
				secure: env['EMAIL_SMTP_SECURE'],
				ignoreTLS: env['EMAIL_SMTP_IGNORE_TLS'],
				auth,
				tls,
			} as Record<string, unknown>);
			break;
		case 'mailgun':
			transporter = nodemailer.createTransport(
				mg({
					auth: {
						api_key: env['EMAIL_MAILGUN_API_KEY'] as string,
						domain: env['EMAIL_MAILGUN_DOMAIN'] as string,
					},
					host: env['EMAIL_MAILGUN_HOST'] as string || 'api.mailgun.net',
				}) as any,
			);
			break;
		case 'sendgrid':
			transporter = nodemailer.createTransport(
				sg({
					apiKey: env['EMAIL_SENDGRID_API_KEY'] as string,
				}) as any,
			);
			break;
		default:
			logger.warn('Illegal transport given for email. Check the EMAIL_TRANSPORT env var.');
	}
	

	return transporter;
}
