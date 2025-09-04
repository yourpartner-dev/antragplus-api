import isYourPartnerJWT from './is-yourpartner-jwt.js';
import jwt from 'jsonwebtoken';
import { test, expect } from 'vitest';

test('Returns false for non JWT string', () => {
	const result = isYourPartnerJWT('test');
	expect(result).toBe(false);
});

test('Returns false for JWTs with text payload', () => {
	const token = jwt.sign('plaintext', 'secret');
	const result = isYourPartnerJWT(token);
	expect(result).toBe(false);
});

test(`Returns false if token issuer isn't "yourpartner"`, () => {
	const token = jwt.sign({ payload: 'content' }, 'secret', { issuer: 'omid' });
	const result = isYourPartnerJWT(token);
	expect(result).toBe(false);
});

test(`Returns true if token is valid JWT and issuer is "yourpartner"`, () => {
	const token = jwt.sign({ payload: 'content' }, 'secret', { issuer: 'yourpartner' });
	const result = isYourPartnerJWT(token);
	expect(result).toBe(true);
});
