import type { Driver, Range } from '../storage-manager/index.js';
import { normalizePath } from '../../helpers/utils/index.js';
import { put, del, list, head, type ListBlobResult, type HeadBlobResult } from '@vercel/blob';
import { Readable } from 'node:stream';
import { join } from 'node:path';

export type DriverVercelConfig = {
	root?: string;
	token: string;
	url: string;
};

export default class DriverVercel implements Driver {
	private root: string;
	private token: string;

	constructor(config: DriverVercelConfig) {
		this.root = config.root ? normalizePath(config.root, { removeLeading: true }) : '';
		this.token = config.token;
		
		// Set the BLOB_READ_WRITE_TOKEN environment variable for @vercel/blob
		process.env['BLOB_READ_WRITE_TOKEN'] = this.token;
	}

	private fullPath(filePath: string): string {
		return normalizePath(join(this.root, filePath));
	}

	async read(filePath: string, range?: Range): Promise<Readable> {
		const fullPath = this.fullPath(filePath);

		try {
			// Get blob metadata to obtain the downloadUrl
			const blobInfo = await head(fullPath, {
				token: this.token,
			});

			// Fetch the file using the downloadUrl
			const response = await fetch(blobInfo.downloadUrl, {
				headers: {
					...(range && {
						Range: `bytes=${range.start}-${range.end || ''}`,
					}),
				},
			});

			if (!response.ok) {
				throw new Error(`Failed to read file: ${response.statusText}`);
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			// Convert Web ReadableStream to Node.js Readable
			const reader = response.body!.getReader();
			const readable = new Readable({
				async read() {
					try {
						const { done, value } = await reader.read();
						if (done) {
							this.push(null);
						} else {
							this.push(Buffer.from(value));
						}
					} catch (error) {
						this.destroy(error as Error);
					}
				}
			});
			
			return readable;
		} catch (error) {
			throw new Error(`Unable to read file "${fullPath}": ${error}`);
		}
	}

	async write(filePath: string, content: Readable, _type?: string): Promise<void> {
		const fullPath = this.fullPath(filePath);

		try {
			const chunks: Buffer[] = [];
			for await (const chunk of content) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const data = Buffer.concat(chunks as Uint8Array[]);

			await put(fullPath, data, {
				access: 'public',
				token: this.token,
			});
		} catch (error) {
			throw new Error(`Unable to write file "${fullPath}": ${error}`);
		}
	}

	async delete(filePath: string): Promise<void> {
		const fullPath = this.fullPath(filePath);

		try {
			await del(fullPath, {
				token: this.token,
			});
		} catch (error) {
			throw new Error(`Unable to delete file "${fullPath}": ${error}`);
		}
	}

	async stat(filePath: string): Promise<{ size: number; modified: Date }> {
		const fullPath = this.fullPath(filePath);

		try {
			const result: HeadBlobResult = await head(fullPath, {
				token: this.token,
			});

			return {
				size: result.size,
				modified: new Date(result.uploadedAt),
			};
		} catch (error) {
			throw new Error(`Unable to get file stats for "${fullPath}": ${error}`);
		}
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			await this.stat(filePath);
			return true;
		} catch {
			return false;
		}
	}

	async move(src: string, dest: string): Promise<void> {
		// Vercel Blob doesn't have native move, so we copy and delete
		await this.copy(src, dest);
		await this.delete(src);
	}

	async copy(src: string, dest: string): Promise<void> {
		const srcFullPath = this.fullPath(src);
		const destFullPath = this.fullPath(dest);

		try {
			// Read the source file
			const srcStream = await this.read(src);
			
			// Write to destination
			await this.write(dest, srcStream);
		} catch (error) {
			throw new Error(`Unable to copy file from "${srcFullPath}" to "${destFullPath}": ${error}`);
		}
	}

	async *list(prefix = ''): AsyncIterable<string> {
		const fullPrefix = this.fullPath(prefix);

		try {
			const result: ListBlobResult = await list({
				prefix: fullPrefix,
				token: this.token,
			});

			for (const blob of result.blobs) {
				const key = this.root ? blob.pathname.replace(`${this.root}/`, '') : blob.pathname;
				yield key;
			}
		} catch (error) {
			throw new Error(`Unable to list files with prefix "${fullPrefix}": ${error}`);
		}
	}
}