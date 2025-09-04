import type { Notification, PrimaryKey } from '../types/index.js';
import { useLogger } from '../helpers/logger/index.js';
import type { AbstractServiceOptions, MutationOptions } from '../types/index.js';
import { md } from '../helpers/utils/md.js';
import { Url } from '../helpers/utils/url.js';
import { ItemsService } from './items.js';
import { MailService } from './mail/index.js';
import { UsersService } from './users.js';
import getDatabase from '../database/index.js';

const logger = useLogger();

export class NotificationsService extends ItemsService {
	usersService: UsersService;
	mailService: MailService;
	
	constructor(options: AbstractServiceOptions) {
		super('yp_notifications', options);
		this.usersService = new UsersService({ schema: this.schema });
		this.mailService = new MailService({ schema: this.schema, accountability: this.accountability });
	}

	override async createOne(data: Partial<Notification>, opts?: MutationOptions, template?:string): Promise<PrimaryKey> {
		const response = await super.createOne(data, opts);

		await this.sendEmail(data, template);

		return response;
	}

	async sendEmail(data: Partial<Notification>, template?:string) {
		if (data.recipient) {
			const user = await this.usersService.readOne(data.recipient, {
				fields: ['id', 'email', 'email_notifications', 'role.app_access', 'language'],
			});

			let manageUserAccountUrl;
			const knex = getDatabase();

			if (data.organization_id) {
				const settings = await knex
					.select('project_url')
					.from('yp_settings')
					.where('organization_id', data.organization_id)
					.first();

				if (settings?.project_url) {
					manageUserAccountUrl = new Url(settings.project_url).toString() + '?opn=true';
				}
			} else {
				const settings = await knex
					.select('project_url')
					.from('yp_settings')
					.where('organization_id', null)
					.first();

				if (settings?.project_url) {
					manageUserAccountUrl = new Url(settings.project_url).toString() + '?opn=true';
				} 
			}

			// If the settings are not up to date or not set correctly, we should not block the notification from being sent.
			if (!manageUserAccountUrl) {
				logger.error('PROJECT_URL is not set, not able to set CTA for notification, setting to empty string');
				manageUserAccountUrl = ''
			}

			const html = data.message ? md(data.message) : '';

			if (user['email'] && user['email_notifications'] === true) {
				this.mailService
					.send({
						template: {
							name: template || 'notification',
							data: user['role']?.app_access ? { url: manageUserAccountUrl, html, ...(data.params || {}) } : { html, ...(data.params || {}) },
						},
						organization_id: data.organization_id || null,
						language: data.language || 'de-DE',
						to: user['email'],
						subject: data.subject,
					})
					.catch((error) => {
						logger.error(error, `Could not send notification via mail`);
					});
			}
		}
	}
}
