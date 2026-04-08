import type { Aggregate, Relation, SchemaOverview } from '@directus/types';
import { getRelationInfo } from '@directus/utils';
import type { Knex } from 'knex';
import { extractFunctionName } from '../../../../utils/extract-function-name.js';
import type { AliasMap } from '../../../../utils/get-column-path.js';
import { getColumnPath } from '../../../../utils/get-column-path.js';
import { splitFieldPath } from '../../../../utils/split-field-path.js';
import { getColumn } from '../../utils/get-column.js';
import { addJoin } from './add-join.js';

export type ColumnSortRecord = { order: 'asc' | 'desc'; column: string };

export function applySort(
	knex: Knex,
	schema: SchemaOverview,
	rootQuery: Knex.QueryBuilder,
	sort: string[],
	aggregate: Aggregate | null | undefined,
	collection: string,
	aliasMap: AliasMap,
	returnRecords = false,
	userAlias?: Record<string, string>,
	jsonAliasMap?: Record<string, string>,
) {
	const relations: Relation[] = schema.relations;
	let hasJoins = false;
	let hasMultiRelationalSort = false;

	const sortRecords = sort.map((sortField) => {
		const column: string[] = splitFieldPath(sortField);
		let order: 'asc' | 'desc' = 'asc';

		if (sortField.startsWith('-')) {
			order = 'desc';
		}

		if (column[0]!.startsWith('-')) {
			column[0] = column[0]!.substring(1);
		}

		// Is the column name one of the aggregate functions used in the query if there is any?
		if (Object.keys(aggregate ?? {}).includes(column[0]!)) {
			// If so, return the column name without the order prefix
			const operation = column[0]!;

			// Get the field for the aggregate function
			const field = column[1]!;

			// If the operation is countAll there is no field.
			if (operation === 'countAll') {
				return {
					order,
					column: 'countAll',
				};
			}

			// If the operation is a root count there is no field.
			if (operation === 'count' && (field === '*' || !field)) {
				return {
					order,
					column: 'count',
				};
			}

			// Return the column name with the operation and field name
			return {
				order,
				column: returnRecords ? column[0] : `${operation}->${field}`,
			};
		}

		if (column.length === 1) {
			const rawField = column[0]!;
			// Resolve user-defined alias before processing
			const resolvedField = userAlias?.[rawField] ?? rawField;

			// Direct json() call or alias that resolves to json()
			if (extractFunctionName(resolvedField) === 'json') {
				return {
					order,
					column: returnRecords ? resolvedField : (getColumn(knex, collection, resolvedField, false, schema) as any),
				};
			}

			// Sort by auto-generated json alias (e.g., metadata_color_json)
			const jsonFnName = jsonAliasMap?.[rawField];

			if (jsonFnName) {
				return {
					order,
					column: returnRecords ? jsonFnName : (getColumn(knex, collection, jsonFnName, false, schema) as any),
				};
			}

			const pathRoot = resolvedField.split(':')[0]!;
			const { relation, relationType } = getRelationInfo(relations, collection, pathRoot);

			if (!relation || ['m2o', 'a2o'].includes(relationType ?? '')) {
				return {
					order,
					column: returnRecords ? resolvedField : (getColumn(knex, collection, resolvedField, false, schema) as any),
				};
			}
		}

		const { hasMultiRelational, isJoinAdded } = addJoin({
			path: column,
			collection,
			aliasMap,
			rootQuery,
			schema,
			knex,
		});

		const { columnPath, targetCollection } = getColumnPath({
			path: column,
			collection,
			aliasMap,
			relations,
			schema,
		});

		const parts = splitFieldPath(columnPath);
		const [alias, ...rest] = parts;
		const field = rest.join('.');

		if (!hasJoins) {
			hasJoins = isJoinAdded;
		}

		if (!hasMultiRelationalSort) {
			hasMultiRelationalSort = hasMultiRelational;
		}

		return {
			order,
			column: returnRecords
				? columnPath
				: (getColumn(knex, alias!, field, false, schema, { originalCollectionName: targetCollection }) as any),
		};
	});

	if (returnRecords) return { sortRecords, hasJoins, hasMultiRelationalSort };

	// Clears the order if any, eg: from MSSQL offset
	rootQuery.clear('order');

	rootQuery.orderBy(sortRecords);

	return { hasJoins, hasMultiRelationalSort };
}
