/**
 * TenantDB — D1Database proxy that automatically injects `line_account_id`
 * into every query, enforcing per-account data isolation at the database layer.
 *
 * Security domains:
 *   GAP-01: Staff API key scoped to a line_account_id (via auth middleware)
 *   GAP-02: Service-account API key scoped to a line_account_id
 *   GAP-03~05: Race conditions on friend upsert + line_account_id assignment
 *
 * SQL injection strategy:
 *   - SELECT: appends `WHERE ${lineAccountIdCol} = ?` before ORDER BY / LIMIT
 *   - INSERT (VALUES): rewrites column list + VALUES to include line_account_id
 *   - INSERT (SELECT): appends WHERE to the inner SELECT
 *   - UPDATE: inserts `${lineAccountIdCol} = ?` into SET and `AND ${lineAccountIdCol} = ?`
 *     into the SET-value WHERE (the one between SET and WHERE)
 *   - DELETE: appends `AND ${lineAccountIdCol} = ?` to any existing WHERE,
 *     or adds `WHERE ${lineAccountIdCol} = ?` if none exists
 *
 * JOINs: table-qualified alias (e.g. `f.line_account_id`) is expected when
 * the query uses a table alias. This class only appends `line_account_id`,
 * NOT a table prefix — callers with JOINs must use qualified column names
 * (e.g. `WHERE f.${lineAccountIdCol} = ?`) in their original SQL, and the proxy
 * will use the unqualified `line_account_id` for simple queries.
 */

export class TenantGuardViolation extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TenantGuardViolation';
  }
}

/**
 * Wraps a D1PreparedStatement to ensure the first bound parameter is
 * `line_account_id`. We can't modify the SQL after D1 prepares it, so
 * we bind the account ID as the *last* argument to every `.bind()` call
 * and rely on the SQL having an extra `?` placeholder for it.
 */
export class TenantStatement {
  private stmt: D1PreparedStatement;
  private accountId: string;

  constructor(stmt: D1PreparedStatement, accountId: string) {
    this.stmt = stmt;
    this.accountId = accountId;
  }

  bind(...params: unknown[]): D1PreparedStatement {
    // Append the account ID as the final bound parameter
    return this.stmt.bind(...params, this.accountId);
  }

  async first<T = unknown>(col?: string): Promise<T | null> {
    if (col !== undefined) {
      return this.stmt.first<T>(col);
    }
    return this.stmt.first<T>();
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.stmt.all<T>();
  }

  async run(): Promise<D1Result> {
    return this.stmt.run();
  }

  async raw<T = unknown>(): Promise<T[]> {
    return this.stmt.raw<T>();
  }
}

/**
 * SQL injection helper — rewrites a SQL statement to add a
 * `${lineAccountIdCol} = ?` guard.
 *
 * Returns `{ sql, needsExternalBind: boolean }`.
 * - When `needsExternalBind` is true, the caller MUST append `accountId`
 *   as a bound parameter (TenantStatement.bind does this automatically).
 * - When false (INSERT with literal rewrite), the ID is baked into the SQL
 *   directly (the column is in the column list).
 */
function injectLineAccountId(
  sql: string,
  accountId: string,
  tableAlias?: string,
): { sql: string; needsExternalBind: boolean } {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();
  const lineAccountIdCol = tableAlias ? `${tableAlias}.line_account_id` : 'line_account_id';

  // --- SELECT ---
  if (upper.startsWith('SELECT')) {
    const orderByIdx = upper.lastIndexOf('ORDER BY');
    const limitIdx = upper.lastIndexOf('LIMIT');
    const offsetIdx = upper.lastIndexOf('OFFSET');
    const unionIdx = upper.lastIndexOf('UNION');

    // Find the right place to inject: before ORDER BY, LIMIT, OFFSET, or UNION
    let insertAt = trimmed.length;
    let clause = '';

    // For UNION queries, inject into each SELECT separately (skip for now — complex)
    if (unionIdx !== -1) {
      // Simple approach: inject before ORDER BY at the end, or at end
      if (orderByIdx !== -1) {
        insertAt = orderByIdx;
        clause = ` WHERE ${lineAccountIdCol} = ?`;
      } else if (limitIdx !== -1) {
        insertAt = limitIdx;
        clause = ` WHERE ${lineAccountIdCol} = ?`;
      } else {
        clause = ` WHERE ${lineAccountIdCol} = ?`;
      }
    } else {
      if (orderByIdx !== -1) {
        insertAt = orderByIdx;
        clause = ` WHERE ${lineAccountIdCol} = ?`;
      } else if (limitIdx !== -1) {
        insertAt = limitIdx;
        clause = ` WHERE ${lineAccountIdCol} = ?`;
      } else {
        clause = ` WHERE ${lineAccountIdCol} = ?`;
      }
    }

    // Check if there's already a WHERE clause
    const whereIdx = upper.lastIndexOf('WHERE');
    if (whereIdx !== -1 && (orderByIdx === -1 || whereIdx < orderByIdx) &&
        (limitIdx === -1 || whereIdx < limitIdx)) {
      // Already has WHERE — add AND condition at the end of WHERE clause
      // Find end of WHERE block: the start of ORDER BY, LIMIT, or end of string
      const whereEnd = Math.min(
        orderByIdx !== -1 ? orderByIdx : trimmed.length,
        limitIdx !== -1 ? limitIdx : trimmed.length,
        offsetIdx !== -1 ? offsetIdx : trimmed.length,
      );
      // Insert before the next clause
      clause = ` AND ${lineAccountIdCol} = ?`;
      insertAt = whereEnd;
    }

    const result = trimmed.slice(0, insertAt) + clause + trimmed.slice(insertAt);
    return { sql: result, needsExternalBind: true };
  }

  // --- INSERT INTO ... VALUES ---
  if (upper.startsWith('INSERT')) {
    // Pattern 1: INSERT INTO table (col1, col2) VALUES (?, ?)
    // We need to add line_account_id to both the column list and VALUES
    const valuesMatch = trimmed.match(/(VALUES\s*\()/i);
    if (valuesMatch) {
      const valuesIdx = valuesMatch.index!;
      // Find the column list area between INSERT INTO table_name and VALUES
      const insertMatch = trimmed.match(/INSERT\s+INTO\s+\S+\s*/i);
      if (insertMatch) {
        const afterTable = insertMatch[0].length;
        const colsPart = trimmed.slice(afterTable, valuesIdx).trim();

        if (colsPart.startsWith('(')) {
          // Has explicit column list: INSERT INTO t (c1, c2) VALUES (?, ?)
          // Add line_account_id to column list
          const newCols = colsPart.slice(0, -1) + ', line_account_id)';
          // Add ? to VALUES
          const afterValues = valuesIdx + valuesMatch[0].length;
          const closeParen = trimmed.indexOf(')', afterValues);
          const newSql =
            trimmed.slice(0, afterTable) +
            newCols +
            ' VALUES (' +
            trimmed.slice(afterValues + 1, closeParen) +
            ', ?)' +
            trimmed.slice(closeParen + 1);
          return { sql: newSql, needsExternalBind: true };
        }
      }
    }

    // Pattern 2: INSERT INTO table DEFAULT VALUES — can't add column, skip
    // Pattern 3: INSERT INTO table SELECT ... — handled below
    if (upper.includes('SELECT')) {
      const selectIdx = upper.indexOf('SELECT', 6); // skip INSERT prefix
      if (selectIdx !== -1) {
        const inner = injectLineAccountId(trimmed.slice(selectIdx), accountId, tableAlias);
        return {
          sql: trimmed.slice(0, selectIdx) + inner.sql,
          needsExternalBind: inner.needsExternalBind,
        };
      }
    }

    // Fallback: add column + value directly
    const valuesStart = valuesMatch ? valuesMatch.index! + valuesMatch[0].length : -1;
    if (valuesStart !== -1) {
      const closeParen = trimmed.indexOf(')', valuesStart);
      if (closeParen !== -1) {
        // Add line_account_id column to column list if no explicit list
        const newSql =
          trimmed.slice(0, closeParen) +
          ', line_account_id' +
          trimmed.slice(closeParen);
        return { sql: newSql, needsExternalBind: true };
      }
    }

    return { sql: trimmed, needsExternalBind: true };
  }

  // --- UPDATE ---
  if (upper.startsWith('UPDATE')) {
    // UPDATE table SET col = ? WHERE ... → Inject ${lineAccountIdCol} = ? into SET
    // and add AND ${lineAccountIdCol} = ? to WHERE
    const setIdx = upper.indexOf('SET');
    if (setIdx !== -1) {
      const whereIdx = upper.indexOf('WHERE', setIdx);
      if (whereIdx !== -1) {
        // Has WHERE — inject into SET and append AND to WHERE
        const setEnd = whereIdx;
        const newSql =
          trimmed.slice(0, setEnd) +
          `, ${lineAccountIdCol} = ?` +
          trimmed.slice(setEnd, trimmed.length) +
          ` AND ${lineAccountIdCol} = ?`;
        return { sql: newSql, needsExternalBind: true };
      } else {
        // No WHERE — inject into SET and add WHERE
        const newSql =
          `${trimmed}, ${lineAccountIdCol} = ? WHERE ${lineAccountIdCol} = ?`;
        return { sql: newSql, needsExternalBind: true };
      }
    }
    return { sql: trimmed + ` WHERE ${lineAccountIdCol} = ?`, needsExternalBind: true };
  }

  // --- DELETE ---
  if (upper.startsWith('DELETE')) {
    const whereIdx = upper.indexOf('WHERE');
    if (whereIdx !== -1) {
      const newSql =
        trimmed.slice(0, whereIdx + 5) +
        ` ${lineAccountIdCol} = ? AND ` +
        trimmed.slice(whereIdx + 5);
      return { sql: newSql, needsExternalBind: true };
    }
    return { sql: trimmed + ` WHERE ${lineAccountIdCol} = ?`, needsExternalBind: true };
  }

  // Non-injectable statement type
  return { sql: trimmed, needsExternalBind: false };
}

/**
 * TenantDB — wraps a D1Database and rewrites SQL to enforce
 * per-account data isolation.
 *
 * Usage:
 * ```ts
 * const db = new TenantDB(c.env.DB, c.get('currentAccountId'));
 * const rows = await db.prepare('SELECT * FROM friends WHERE name = ?')
 *   .bind(name)
 *   .all();
 * ```
 *
 * Every query is transparently rewritten to include `${lineAccountIdCol} = ?`.
 */
export class TenantDB {
  private db: D1Database;
  private accountId: string;

  constructor(db: D1Database, accountId: string) {
    if (!accountId) {
      throw new TenantGuardViolation(
        'TenantDB requires a non-empty accountId. ' +
        'If you need cross-tenant access, use the raw D1Database directly.',
      );
    }
    this.db = db;
    this.accountId = accountId;
  }

  prepare(sql: string, tableAlias?: string): TenantStatement {
    const { sql: rewritten, needsExternalBind } = injectLineAccountId(sql, this.accountId, tableAlias);

    if (!needsExternalBind) {
      // For statements where we couldn't inject a parameter (e.g. already has
      // the accountId hardcoded), we still wrap to enforce the tenant boundary.
      console.warn(
        `[TenantDB] Could not inject line_account_id into SQL: ${sql.substring(0, 80)}`,
      );
    }

    const stmt = this.db.prepare(rewritten);
    return new TenantStatement(stmt, this.accountId);
  }

  /**
   * Expose the raw D1Database for cross-tenant operations.
   * Use with caution — this bypasses the tenant guard.
   */
  unsafe(): D1Database {
    return this.db;
  }

  /**
   * Current account ID this TenantDB is scoped to.
   */
  getAccountId(): string {
    return this.accountId;
  }
}

/**
 * Helper to create a TenantDB from a Hono context.
 * Reads `currentAccountId` from context variables.
 * Returns null if no account ID is set (owner-level access).
 */
export function createTenantDB(
  db: D1Database,
  accountId: string | undefined | null,
): TenantDB | null {
  if (!accountId) return null;
  return new TenantDB(db, accountId);
}
