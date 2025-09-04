import { ItemsService } from './items.js';
import { FilesService } from './files.js';
import type { PrimaryKey } from '../types/index.js';
import type { Organization } from '../types/organization.js';
import { useEnv } from '../helpers/env/index.js';
import { toArray } from '../helpers/utils/to-array.js';

const env = useEnv();

export class OrganizationsService extends ItemsService<Organization, string> {
	constructor(options: any) {
		super('yp_organizations', options);
	}

	private async handleLogo(logo: any, existingLogoId?: string | null): Promise<string | null> {
		if (!logo) return null;

		const filesService = new FilesService({
			accountability: this.accountability,
			schema: this.schema,
		});

		// If there's an existing logo and we're updating, delete it
		if (existingLogoId) {
			try {
				await filesService.deleteOne(existingLogoId);
			} catch (error) {
				// Log error but continue with new logo upload
				console.error('Failed to delete existing logo:', error);
			}
		}

		if (typeof logo === 'string') {
			// If it's already a file ID, verify it exists
			try {
				await filesService.readOne(logo);
				return logo;
			} catch {
				return null;
			}
		}

		// If it's a file object, create/update it
		const fileId = await filesService.uploadOne(logo, {
			storage: toArray(env['STORAGE_LOCATIONS'] as string)[0]!,
			filename_download: logo.name,
			type: logo.type,
		});
		return fileId.toString();
	}

	override async createOne(data: Partial<Organization>): Promise<PrimaryKey> {
		if (data.logo) {
			data.logo = await this.handleLogo(data.logo);
		}
		return await super.createOne(data);
	}

	override async updateOne(key: PrimaryKey, data: Partial<Organization>): Promise<PrimaryKey> {
		if (data.logo) {
			// Get existing organization to check for current logo
			const existingOrg = await this.readOne(key);
			data.logo = await this.handleLogo(data.logo, existingOrg?.logo);
		}
		return await super.updateOne(key, data);
	}

	override async updateMany(keys: PrimaryKey[], data: Partial<Organization>): Promise<PrimaryKey[]> {
		if (data.logo) {
			// Get existing organizations to check for current logos
			const existingOrgs = await this.readMany(keys);
			// Delete all existing logos
			for (const org of existingOrgs) {
				if (org.logo) {
					await this.handleLogo(null, org.logo);
				}
			}
			// Upload new logo
			data.logo = await this.handleLogo(data.logo);
		}
		return await super.updateMany(keys, data);
	}

	override async updateByQuery(query: any, data: Partial<Organization>): Promise<PrimaryKey[]> {
		if (data.logo) {
			// Get existing organizations to check for current logos
			const existingOrgs = await this.readByQuery(query);
			// Delete all existing logos
			for (const org of existingOrgs) {
				if (org.logo) {
					await this.handleLogo(null, org.logo);
				}
			}
			// Upload new logo
			data.logo = await this.handleLogo(data.logo);
		}
		return await super.updateByQuery(query, data);
	}

	override async deleteOne(key: PrimaryKey): Promise<PrimaryKey> {
		// Get organization to check for logo
		const org = await this.readOne(key);
		if (org?.logo) {
			await this.handleLogo(null, org.logo);
		}
		return await super.deleteOne(key);
	}

	override async deleteMany(keys: PrimaryKey[]): Promise<PrimaryKey[]> {
		// Get organizations to check for logos
		const orgs = await this.readMany(keys);
		// Delete all logos
		for (const org of orgs) {
			if (org.logo) {
				await this.handleLogo(null, org.logo);
			}
		}
		return await super.deleteMany(keys);
	}
} 