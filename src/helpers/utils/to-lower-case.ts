export function toLowerCase(val: string | string[]): string | string[] {
	if (typeof val === 'string') {
		return val.toLowerCase() as unknown as string;
	}

	if (Array.isArray(val)) {
		return val.map(toLowerCase) as string[];
	}

	return val;
}