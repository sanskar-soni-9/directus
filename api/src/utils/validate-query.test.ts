import { useEnv } from '@directus/env';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@directus/env');

beforeEach(() => {
	vi.resetModules();

	vi.mocked(useEnv).mockReturnValue({});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('max limit', () => {
	describe('max limit of 100', async () => {
		vi.mocked(useEnv).mockReturnValue({ QUERY_LIMIT_MAX: 100 });
		const { validateQuery } = await import('./validate-query.js');

		test.each([-1, 1, 25])('should accept number %i', (limit) => {
			expect(() => validateQuery({ limit })).not.toThrowError('limit');
		});

		test('should error with 101', () => {
			expect(() => validateQuery({ limit: 101 })).toThrowError('limit');
		});
	});

	test('should accept 101 when no limit defined', async () => {
		const { validateQuery } = await import('./validate-query.js');

		expect(() => validateQuery({ limit: 101 })).not.toThrowError('limit');
	});

	test('should accept 101 when unlimited', async () => {
		vi.mocked(useEnv).mockReturnValue({ QUERY_LIMIT_MAX: -1 });
		const { validateQuery } = await import('./validate-query.js');

		expect(() => validateQuery({ limit: 101 })).not.toThrowError('limit');
	});
});

describe('export', async () => {
	const { validateQuery } = await import('./validate-query.js');

	test.each(['csv', 'csv_utf8', 'json', 'xml', 'yaml'])('should accept format %i', (format) => {
		expect(() => validateQuery({ export: format } as any)).not.toThrowError();
	});

	test('should error with invalid formats', () => {
		expect(() => validateQuery({ export: 'invalid-format' } as any)).toThrowError('"export" must be one of');
		expect(() => validateQuery({ export: 'csv_invalid' } as any)).toThrowError('"export" must be one of');
	});
});

describe('validateBoolean', async () => {
	const { validateBoolean } = await import('./validate-query.js');

	test.each([true, '', null, false])('should allow value %s', (value: unknown) => {
		expect(() => validateBoolean(value, 'test')).not.toThrowError();
	});

	test.each([undefined, 'wrong'])('should fail on value %s', (value: unknown) => {
		expect(() => validateBoolean(value, 'test')).toThrowError('"test" has to be a boolean');
	});
});

describe('validateGeometry', async () => {
	const { validateGeometry } = await import('./validate-query.js');

	test.each([
		'',
		null,
		{
			type: 'Point',
			coordinates: [30.0, 10.0],
		},
	])('should allow value %s', (value: unknown) => {
		expect(() => validateGeometry(value, 'test')).not.toThrowError();
	});

	test.each([undefined, 'wrong', {}])('should fail on value %s', (value: unknown) => {
		expect(() => validateGeometry(value, 'test')).toThrowError('"test" has to be a valid GeoJSON object');
	});
});

describe('alias validation', async () => {
	const { validateQuery } = await import('./validate-query.js');

	test('accepts plain field alias', () => {
		expect(() => validateQuery({ alias: { myAlias: 'some_field' } })).not.toThrow();
	});

	test('accepts valid json() function in alias value', () => {
		expect(() => validateQuery({ alias: { myAlias: 'json(metadata, color)' } })).not.toThrow();
	});

	test('accepts json() with dot path in alias value', () => {
		expect(() => validateQuery({ alias: { myAlias: 'json(metadata, settings.theme)' } })).not.toThrow();
	});

	test('accepts json() with relational path in alias value', () => {
		expect(() => validateQuery({ alias: { myAlias: 'json(category_id.metadata, color)' } })).not.toThrow();
	});

	test('rejects alias value with dot (non-json)', () => {
		expect(() => validateQuery({ alias: { myAlias: 'relation.field' } })).toThrow(
			`"alias" value can't contain a period`,
		);
	});

	test('rejects alias key with dot', () => {
		expect(() => validateQuery({ alias: { 'my.alias': 'field' } })).toThrow(`"alias" key can't contain a period`);
	});

	test('rejects malformed json() syntax in alias value — missing comma', () => {
		expect(() => validateQuery({ alias: { myAlias: 'json(metadata)' } })).toThrow('Invalid json() syntax');
	});

	test('rejects malformed json() syntax in alias value — missing field', () => {
		expect(() => validateQuery({ alias: { myAlias: 'json(, color)' } })).toThrow('Invalid json() syntax');
	});

	test('rejects malformed json() syntax in alias value — missing path', () => {
		expect(() => validateQuery({ alias: { myAlias: 'json(metadata,)' } })).toThrow('Invalid json() syntax');
	});
});

describe('alias relational depth', async () => {
	vi.mocked(useEnv).mockReturnValue({ MAX_RELATIONAL_DEPTH: 2 });
	const { validateQuery } = await import('./validate-query.js');

	test('checks depth against resolved alias value, not key', () => {
		// alias key "myAlias" has depth 1, but the value resolves to depth 2 (category_id + metadata)
		expect(() =>
			validateQuery({
				fields: ['myAlias'],
				alias: { myAlias: 'json(category_id.metadata, color)' },
			}),
		).not.toThrow();
	});

	test('rejects alias that resolves beyond max relational depth', () => {
		// depth 3: a.b.c
		expect(() =>
			validateQuery({
				fields: ['myAlias'],
				alias: { myAlias: 'json(a.b.field, path)' },
			}),
		).toThrow('Max relational depth exceeded');
	});
});
