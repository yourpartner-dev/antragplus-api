import jwt from 'jsonwebtoken';

/**
 * Check if a given string conforms to the structure of a JWT
 * and whether it is issued by YourPartner.
 */
export default function isYourPartnerJWT(string: string): boolean {
	try {
		const payload = jwt.decode(string, { json: true });
		if (payload?.iss !== 'yourpartner') return false;
		return true;
	} catch {
		return false;
	}
}
