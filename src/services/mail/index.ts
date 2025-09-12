import { useEnv } from '../../helpers/env/index.js';
import { InvalidPayloadError } from '../../helpers/errors/index.js';
import type { Accountability, SchemaOverview } from '../../types/index.js';
import fse from 'fs-extra';
import type { Knex } from 'knex';
import { Liquid } from 'liquidjs';
import type { SendMailOptions, Transporter } from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import getDatabase from '../../database/index.js';
import { useLogger } from '../../helpers/logger/index.js';
import getMailer from '../../mailer.js';
import type { AbstractServiceOptions } from '../../types/index.js';
import emitter from '../../emitter.js';
import { Url } from '../../helpers/utils/url.js';

const env = useEnv();
const logger = useLogger();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const liquidEngine = new Liquid({
	root: [path.resolve(env['EMAIL_TEMPLATES_PATH'] as string), path.resolve(__dirname, 'templates')],
	extname: '.liquid',
});

export type EmailOptions = SendMailOptions & {
	template?: {
		name: string;
		data: Record<string, any>;
	};
	organization_id: string | null;
	language:  string;
};

export class MailService {
	schema: SchemaOverview;
	accountability: Accountability | null;
	knex: Knex;
	mailer: Transporter;

	constructor(opts: AbstractServiceOptions) {
		this.schema = opts.schema;
		this.accountability = opts.accountability || null;
		this.knex = opts?.knex || getDatabase();
		this.mailer = getMailer();

		if (env['EMAIL_VERIFY_SETUP']) {
			this.mailer.verify((error) => {
				if (error) {
					logger.warn(`Email connection failed:`);
					logger.warn(error);
				}
			});
		}
	}

	async send<T>(options: EmailOptions): Promise<T | null> {

		logger.info(`Sending email to ${options.to}`);
		const payload = await emitter.emitFilter(`email.send`, options, {
			database: getDatabase(),
			schema: null,
			accountability: null,
		});

		if (!payload) return null;

		const { template, ...emailOptions } = payload;

		let { html } = options;

		let defaultTemplateData = await this.getDefaultTemplateData(options.organization_id || null);

		const from_email = defaultTemplateData.fromEmail || options.from || (env['EMAIL_FROM'] as string);
		const from = `${defaultTemplateData.projectName} <${from_email}>`;

		if (template) {
			let templateData = template.data;

			templateData = {
				...defaultTemplateData,
				...templateData,
			};
			html = await this.renderTemplate(template.name, templateData, options.language || 'en-US');
		}

		if (typeof html === 'string') {
			// Some email clients start acting funky when line length exceeds 75 characters. See #6074
			html = html
				.split('\n')
				.map((line) => line.trim())
				.join('\n');
		}

		const info = await this.mailer.sendMail({ ...emailOptions, from, html });
		return info;
	}

	private async renderTemplate(template: string, variables: Record<string, any>, language: string) {
		const isBase = template === 'base';	
		//TODO: add support for other languages
		const l = language === 'de-DE' ? 'de' : 'en';
		const customTemplatePath = path.resolve(env['EMAIL_TEMPLATES_PATH'] as string, template + `${isBase ? '' : `-${l}`}` + ".liquid");
		const systemTemplatePath = path.join(__dirname, 'templates', template + `${isBase ? '' : `-${l}`}` + ".liquid");

		const templatePath = (await fse.pathExists(customTemplatePath)) ? customTemplatePath : systemTemplatePath;

		if ((await fse.pathExists(templatePath)) === false) {
			throw new InvalidPayloadError({ reason: `Template "${template}" doesn't exist` });
		}

		const templateString = await fse.readFile(templatePath, 'utf8');
		const html = await liquidEngine.parseAndRender(templateString, variables);

		return html;
	}

	private async getDefaultTemplateData(organization_id: string | null) {
		const projectInfo = await this.knex
			.select(['project_name', 'project_logo', 'project_color', 'project_url', 'project_from_email'])
			.from('yp_settings')
			.where('organization_id', organization_id)
			.first();

		return {
			projectName: projectInfo?.project_name || 'YourPartner',
			projectColor: projectInfo?.project_color || '#75a9d6',
			projectUrl: projectInfo?.project_url || env['PUBLIC_URL'] as string || '',
			projectLogo: this.getProjectLogoURL(projectInfo?.project_logo, env['PUBLIC_URL'] as string),
			fromEmail: projectInfo?.project_from_email || env['EMAIL_FROM'] as string || '',
		};

	}

	private getProjectLogoURL(logoID: string, url: string) {
		const projectLogoUrl = new Url(url);
		return projectLogoUrl.addPath('assets', logoID);
	}
}
