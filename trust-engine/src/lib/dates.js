/**
 * Date handling.
 *
 * MySQL and TiDB reject ISO-8601 timestamps with a `T` separator and `Z` suffix
 * in DATETIME columns, while JSON APIs naturally produce exactly that format.
 * Every value bound to the database passes through `normalizeParam`, which
 * rewrites only strict ISO-8601 date-time strings (and Date objects) into the
 * `YYYY-MM-DD HH:MM:SS.mmm` form both engines accept. Date-only strings and
 * all other values are left untouched.
 */

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;

export function toSqlDateTime(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 23).replace('T', ' ');
  }
  if (typeof value !== 'string') return value;
  if (!ISO_DATE_TIME.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 23).replace('T', ' ');
}

export function normalizeParam(value) {
  if (value instanceof Date) return toSqlDateTime(value);
  if (typeof value === 'string' && value.length >= 19 && value[10] === 'T') return toSqlDateTime(value);
  return value;
}

export function normalizeParams(params) {
  if (!Array.isArray(params)) return params;
  return params.map(normalizeParam);
}
