import { InvalidPayloadError } from '@directus/errors';
import type { RawField } from '@directus/types';
import { describe, expect, test } from 'vitest';
import { systemVersionFields } from './constants.js';
import { toVersionCollection } from './to-version-collection.js';

describe('toVersionCollection', () => {
	const collection = {
		collection: 'articles',
		schema: {
			name: 'articles',
			comment: null,
		},
		meta: {
			collection: 'articles',
			note: null,
			hidden: false,
			singleton: false,
			versioning: false,
		},
	};

	describe('validation', () => {
		test('throws on folder collections', () => {
			expect(() => toVersionCollection({ ...collection, schema: null })).toThrow(InvalidPayloadError);
		});

		test('does not mutate original payload', () => {
			const original = JSON.parse(JSON.stringify(collection));

			toVersionCollection(collection);

			expect(collection).toEqual(original);
		});
	});

	describe('naming', () => {
		test('versions collection name', () => {
			const result = toVersionCollection(collection);

			expect(result.collection).toBe('directus_versions_articles');
		});

		test('versions meta.collection', () => {
			const result = toVersionCollection(collection);

			expect(result.meta!.collection).toBe('directus_versions_articles');
		});

		test('versions schema.name', () => {
			const result = toVersionCollection(collection);

			expect(result.schema!.name).toBe('directus_versions_articles');
		});
	});

	describe('meta', () => {
		test('sets versioning to false', () => {
			const result = toVersionCollection({ ...collection, meta: { ...collection.meta, versioning: true } });

			expect(result.meta!.versioning).toBe(false);
		});

		test('sets hidden to true', () => {
			const result = toVersionCollection(collection);

			expect(result.meta!.hidden).toBe(true);
		});
	});

	describe('fields', () => {
		test('adds (prepend) system version fields', () => {
			const collectionField = {
				field: 'title',
				type: 'string',
				schema: { is_nullable: true },
				meta: { collection: 'articles' },
			} as RawField;

			const result = toVersionCollection({ ...collection, fields: [collectionField] });

			expect(
				systemVersionFields.every((systemVersionField) =>
					result.fields?.find((field) => field.field === systemVersionField.field),
				),
			).toBeTruthy();

			expect(result.fields?.find((field) => field.field === collectionField.field)).toBeTruthy();
		});

		test('filters out alias fields', () => {
			const result = toVersionCollection({
				...collection,
				fields: [
					{ field: 'title', type: 'string', schema: { is_nullable: true }, meta: { collection: 'articles' } },
					{ field: 'o2m', type: 'alias', schema: null, meta: { collection: 'articles', special: ['o2m'] } },
					{ field: 'status', type: 'string', schema: { is_nullable: true }, meta: { collection: 'articles' } },
				],
			});

			const fieldNames = (result.fields ?? []).map((f: any) => f.field);

			expect(fieldNames).toContain('directus_version_id');
			expect(fieldNames).toContain('title');
			expect(fieldNames).toContain('status');
			expect(fieldNames).not.toContain('o2m');
		});
	});
});
