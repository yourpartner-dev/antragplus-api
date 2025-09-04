import { expect, test } from 'vitest';
import isUrlAllowed from './is-url-allowed.js';

test('isUrlAllowed should allow matching domain', () => {
	const checkUrl = 'https://yourpartner.dev';
	const allowedUrls = ['https://yourpartner.dev/'];

	expect(isUrlAllowed(checkUrl, allowedUrls)).toBe(true);
});

test('isUrlAllowed should allow matching path', () => {
	const checkUrl = 'https://yourpartner.dev/tv';
	const allowedUrls = ['https://yourpartner.dev/tv'];

	expect(isUrlAllowed(checkUrl, allowedUrls)).toBe(true);
});

test('isUrlAllowed should block different paths', () => {
	const checkUrl = 'http://example.com/test1';
	const allowedUrls = ['http://example.com/test2', 'http://example.com/test3', 'http://example.com/'];

	expect(isUrlAllowed(checkUrl, allowedUrls)).toBe(false);
});

test('isUrlAllowed should block different domains', () => {
	const checkUrl = 'http://yourpartner.dev/';
	const allowedUrls = ['http://example.com/', 'http://yp.chat'];

	expect(isUrlAllowed(checkUrl, allowedUrls)).toBe(false);
});

test('isUrlAllowed blocks varying protocols', () => {
	const checkUrl = 'http://example.com/';
	const allowedUrls = ['ftp://example.com/', 'https://example.com/'];

	expect(isUrlAllowed(checkUrl, allowedUrls)).toBe(false);
});
