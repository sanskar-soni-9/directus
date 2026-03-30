import type { Field } from '@directus/types';
import { describe, expect, test } from 'vitest';
import { toVersionField } from './to-version-field.js';

describe('toVersionField', () => {
	describe('regular fields', () => {
		test('versions collection name', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: {},
				meta: {},
			} as Field);

			expect(result.collection).toBe('directus_versions_articles');
		});

		test('versions meta.collection', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: {},
				meta: { collection: 'articles' },
			} as Field);

			expect(result.meta!.collection).toBe('directus_versions_articles');
		});

		test('versions schema.table', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: { table: 'articles' },
				meta: {},
			} as Field);

			expect(result.schema!.table).toBe('directus_versions_articles');
		});

		test('removes meta.id and meta.sort', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: {},
				meta: { id: 1, sort: 2 },
			} as Field);

			expect(result.meta).not.toHaveProperty('id');
			expect(result.meta).not.toHaveProperty('sort');
		});

		test('relaxes constraints', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: { is_nullable: false, is_unique: true, is_primary_key: false },
				meta: {},
			} as Field);

			expect(result.schema!.is_nullable).toBe(true);
			expect(result.schema!.is_unique).toBe(false);
			expect(result.schema!.is_primary_key).toBe(false);
		});

		test('removes validation', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: {},
				meta: {
					required: true,
					validation: { _and: [{ title: { _nnull: true } }] },
					validation_message: 'Required',
					conditions: [{ rule: {} }],
				},
			} as unknown as Field);

			expect(result.meta!.required).toBe(false);
			expect(result.meta!.validation).toBeNull();
			expect(result.meta!.validation_message).toBeNull();
			expect(result.meta!.conditions).toBeNull();
		});

		test('converts primary key to plain string field', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'id',
				type: 'integer',
				schema: { is_primary_key: true, has_auto_increment: true },
				meta: {},
			} as Field);

			expect(result.type).toBe('string');
			expect(result.meta!.interface).toBe('input');
			expect(result.schema!.is_primary_key).toBe(false);
			expect(result.schema!.has_auto_increment).toBe(false);
		});

		test('clears default_value on primary key conversion', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'id',
				type: 'uuid',
				schema: { is_primary_key: true, default_value: 'gen_random_uuid()' },
				meta: {},
			} as Field);

			expect(result.schema!.default_value).toBeNull();
		});

		test('converts auto_increment field without primary key flag', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'sort',
				type: 'integer',
				schema: { has_auto_increment: true, is_primary_key: false },
				meta: {},
			} as Field);

			expect(result.type).toBe('string');
			expect(result.schema!.has_auto_increment).toBe(false);
			expect(result.schema!.default_value).toBeNull();
		});

		test('does not mutate original payload', () => {
			const field = {
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: { table: 'articles', is_nullable: false },
				meta: { id: 1, collection: 'articles', required: true },
			} as Field;

			const original = JSON.parse(JSON.stringify(field));

			toVersionField(field);

			expect(field).toEqual(original);
		});
	});

	describe('alias fields', () => {
		test('versions collection name', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'o2m',
				type: 'alias',
				schema: null,
				meta: { special: ['o2m'] },
			} as Field);

			expect(result.collection).toBe('directus_versions_articles');
		});

		test('versions meta.collection', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'o2m',
				type: 'alias',
				schema: null,
				meta: { collection: 'articles', special: ['o2m'] },
			} as Field);

			expect(result.meta!.collection).toBe('directus_versions_articles');
		});

		test('preserves null schema', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'o2m',
				type: 'alias',
				schema: null,
				meta: { special: ['o2m'] },
			} as Field);

			expect(result.schema).toBeNull();
		});

		test('preserves meta.special', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'o2m',
				type: 'alias',
				schema: null,
				meta: { special: ['o2m'] },
			} as Field);

			expect(result.meta!.special).toEqual(['o2m']);
		});

		test('removes meta.id and meta.sort', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'o2m',
				type: 'alias',
				schema: null,
				meta: { id: 2, sort: 3, special: ['o2m'] },
			} as Field);

			expect(result.meta).not.toHaveProperty('id');
			expect(result.meta).not.toHaveProperty('sort');
		});

		test('versions field name with reference', () => {
			const result = toVersionField(
				{
					collection: 'articles',
					field: 'o2m',
					type: 'alias',
					schema: null,
					meta: { field: 'o2m', special: ['o2m'] },
				} as Field,
				{ reference: true },
			);

			expect(result.field).toBe('directus_versions_o2m');
			expect(result.meta!.field).toBe('directus_versions_o2m');
		});

		test('does not mutate original payload', () => {
			const field = {
				collection: 'articles',
				field: 'o2m',
				type: 'alias',
				schema: null,
				meta: { id: 2, field: 'o2m', special: ['o2m'] },
			} as Field;

			const original = JSON.parse(JSON.stringify(field));

			toVersionField(field, { reference: true });

			expect(field).toEqual(original);
		});
	});

	describe('reference mode', () => {
		test('versions field name', () => {
			const result = toVersionField(
				{ collection: 'articles', field: 'title', type: 'string', schema: {}, meta: {} } as Field,
				{ reference: true },
			);

			expect(result.field).toBe('directus_versions_title');
		});

		test('versions meta.field', () => {
			const result = toVersionField(
				{ collection: 'articles', field: 'title', type: 'string', schema: {}, meta: { field: 'title' } } as Field,
				{ reference: true },
			);

			expect(result.meta!.field).toBe('directus_versions_title');
		});

		test('versions schema.name', () => {
			const result = toVersionField(
				{ collection: 'articles', field: 'title', type: 'string', schema: { name: 'title' }, meta: {} } as Field,
				{ reference: true },
			);

			expect(result.schema!.name).toBe('directus_versions_title');
		});

		test('does not version field name without reference', () => {
			const result = toVersionField({
				collection: 'articles',
				field: 'title',
				type: 'string',
				schema: {},
				meta: {},
			} as Field);

			expect(result.field).toBe('title');
		});
	});
});
