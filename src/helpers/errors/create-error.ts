export interface YPError<Extensions = void> extends Error {
	extensions: Extensions;
	code: string;
	status: number;
}

export interface YPErrorConstructor<Extensions = void> {
	new (extensions: Extensions, options?: ErrorOptions): YPError<Extensions>;
	readonly prototype: YPError<Extensions>;
}

export const createError = <Extensions = void>(
	code: string,
	message: string | ((extensions: Extensions) => string),
	status = 500,
): YPErrorConstructor<Extensions> => {
	return class extends Error implements YPError<Extensions> {
		override name = 'YPError';
		extensions: Extensions;
		code = code.toUpperCase();
		status = status;

		constructor(extensions: Extensions, options?: ErrorOptions) {
			const msg = typeof message === 'string' ? message : message(extensions as Extensions);

			super(msg, options);

			this.extensions = extensions;
		}

		override toString() {
			return `${this.name} [${this.code}]: ${this.message}`;
		}
	};
};
