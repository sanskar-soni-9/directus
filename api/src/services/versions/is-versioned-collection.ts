import type { SchemaOverview } from '@directus/types';
import { toBoolean } from '@directus/utils';
import { toVersionName } from './to-version-name.js';

/**
 * Check whether a version table exists for the given collection.
 */
export function isVersionedCollection(schema: SchemaOverview, collection: string): boolean {
	return toBoolean(schema.collections[collection]?.versioning) || !!schema.collections[toVersionName(collection)];
}
