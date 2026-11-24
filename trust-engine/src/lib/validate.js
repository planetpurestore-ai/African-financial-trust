import { z } from 'zod';
import { unprocessable } from './errors.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
      code: issue.code,
    }));
    throw unprocessable('Request validation failed', details);
  }
  return result.data;
}

export const uuidLike = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a 26-character record id');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'invalid calendar date');

export const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid ISO date-time');

export const currency = z.string().regex(/^[A-Z]{3}$/, 'expected a 3-letter ISO currency code');

export const countryCode = z.string().regex(/^[A-Z]{2}$/, 'expected a 2-letter ISO country code');

export const email = z.string().email().max(255);

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
