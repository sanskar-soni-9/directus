import { describe, expect, it } from 'vitest';

describe('asset cache revalidation', () => {
	const buildETag = (modifiedOn: string) => {
		const unixTime = Date.parse(modifiedOn);
		return `"${Math.floor(unixTime / 1000)}"`;
	};

	const shouldReturn304 = (modifiedOn: string, headers: { 'if-none-match'?: string; 'if-modified-since'?: string }) => {
		const unixTime = Date.parse(modifiedOn);
		if (Number.isNaN(unixTime)) return false;

		const lastModifiedDate = new Date(unixTime);
		const etag = buildETag(modifiedOn);

		if (headers['if-none-match'] === etag) return true;

		if (headers['if-modified-since']) {
			const ifModifiedSinceDate = new Date(headers['if-modified-since']);
			if (Math.floor(lastModifiedDate.getTime() / 1000) <= Math.floor(ifModifiedSinceDate.getTime() / 1000))
				return true;
		}

		return false;
	};

	describe('ETag generation', () => {
		it('generates ETag from modified_on timestamp truncated to seconds', () => {
			expect(buildETag('2026-03-25T12:10:12.000Z')).toBe('"1774440612"');
		});

		it('truncates milliseconds from the timestamp', () => {
			expect(buildETag('2026-03-25T12:10:12.500Z')).toBe('"1774440612"');
		});
	});

	describe('304 with If-None-Match', () => {
		it('returns 304 when ETag matches', () => {
			const modifiedOn = '2026-03-25T12:10:12.000Z';
			const etag = buildETag(modifiedOn);

			expect(shouldReturn304(modifiedOn, { 'if-none-match': etag })).toBe(true);
		});

		it('returns 200 when ETag does not match (file replaced)', () => {
			const oldModifiedOn = '2026-03-25T12:10:12.000Z';
			const newModifiedOn = '2026-04-02T12:12:23.000Z';
			const oldEtag = buildETag(oldModifiedOn);

			expect(shouldReturn304(newModifiedOn, { 'if-none-match': oldEtag })).toBe(false);
		});
	});

	describe('304 with If-Modified-Since', () => {
		it('returns 304 when file has not been modified since', () => {
			const modifiedOn = '2026-03-25T12:10:12.000Z';

			expect(shouldReturn304(modifiedOn, { 'if-modified-since': 'Wed, 25 Mar 2026 12:10:12 GMT' })).toBe(true);
		});

		it('returns 304 when If-Modified-Since is after modified_on', () => {
			const modifiedOn = '2026-03-25T12:10:12.000Z';

			expect(shouldReturn304(modifiedOn, { 'if-modified-since': 'Thu, 03 Apr 2026 00:00:00 GMT' })).toBe(true);
		});

		it('returns 200 when file was modified after If-Modified-Since', () => {
			const modifiedOn = '2026-04-02T12:12:23.000Z';

			expect(shouldReturn304(modifiedOn, { 'if-modified-since': 'Wed, 25 Mar 2026 12:10:12 GMT' })).toBe(false);
		});

		it('handles millisecond precision correctly', () => {
			const modifiedOn = '2026-03-25T12:10:12.500Z';

			expect(shouldReturn304(modifiedOn, { 'if-modified-since': 'Wed, 25 Mar 2026 12:10:12 GMT' })).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('returns false when modified_on is invalid', () => {
			expect(shouldReturn304('invalid-date', { 'if-none-match': '"123"' })).toBe(false);
		});

		it('returns false when no conditional headers are provided', () => {
			expect(shouldReturn304('2026-03-25T12:10:12.000Z', {})).toBe(false);
		});

		it('If-None-Match takes priority over If-Modified-Since', () => {
			const modifiedOn = '2026-03-25T12:10:12.000Z';
			const etag = buildETag(modifiedOn);

			expect(
				shouldReturn304(modifiedOn, {
					'if-none-match': etag,
					'if-modified-since': 'Mon, 01 Jan 2020 00:00:00 GMT',
				}),
			).toBe(true);
		});
	});
});
