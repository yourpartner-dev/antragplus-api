import { nanoid } from 'nanoid';

/**
 * Generates a dummy email address for a user
 * 
 * @param firstName The first name of the user
 * @param domain The domain of the email
 * @returns A dummy email address
 */
export function getDummyEmail(firstName: string, domain: string): string {
    const uniqueId = nanoid(10); // 10 characters is sufficient for uniqueness
    return `${firstName}.${uniqueId}@${domain}`?.toLowerCase();
}

/**
 * Returns a regex pattern that matches the dummy email format:
 * firstName.uniqueId@domain
 * 
 * @param uniqueIdLength The length of the uniqueId part (default: 10)
 * @returns RegExp that matches the dummy email pattern
 */
export function getDummyEmailRegex(uniqueIdLength: number = 10): RegExp {
    return new RegExp(
        `^([\\w-]+)\\.([A-Za-z0-9_-]{${uniqueIdLength}})@([\\w.-]+)$`
    );
}