/**
 * Prisma error translation.
 *
 * The database is the last line of defence for uniqueness: two simultaneous
 * writes both pass an application-level check and one then fails on the index.
 * Callers map that to a 409/200 instead of leaking a 500.
 *
 * @author aliasgarbootwala3@gmail.com
 */

interface PrismaLikeError {
  code?: unknown;
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PrismaLikeError).code === "P2002"
  );
}

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PrismaLikeError).code === "P2003"
  );
}
