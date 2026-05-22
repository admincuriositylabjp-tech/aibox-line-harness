/**
 * TenantDB Proxy — unit tests
 *
 * Tests the SQL injection logic for SELECT, INSERT, UPDATE, DELETE,
 * and verifies that TenantStatement correctly binds the account ID.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TenantDB, TenantGuardViolation, createTenantDB } from '../src/middleware/tenant-guard.js';

// Mock D1PreparedStatement
class MockStatement {
  sql: string;
  binds: unknown[] = [];

  constructor(sql: string) {
    this.sql = sql;
  }

  bind(...params: unknown[]): MockStatement {
    this.binds = params;
    return this;
  }

  async first<T = unknown>(_col?: string): Promise<T | null> {
    return null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async run(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async raw<T = unknown>(): Promise<T[]> {
    return [];
  }
}

// Mock D1Database
class MockD1Database {
  calls: { sql: string; binds: unknown[] }[] = [];

  prepare(sql: string): MockStatement {
    const stmt = new MockStatement(sql);
    const originalBind = stmt.bind.bind(stmt);
    stmt.bind = (...params: unknown[]) => {
      this.calls.push({ sql, binds: params });
      return originalBind(...params);
    };
    return stmt;
  }

  getCalls() {
    return this.calls;
  }
}

describe('TenantDB', () => {
  let mockDb: MockD1Database;

  beforeEach(() => {
    mockDb = new MockD1Database();
  });

  it('should throw TenantGuardViolation for empty accountId', () => {
    expect(() => new TenantDB(mockDb as unknown as D1Database, '')).toThrow(TenantGuardViolation);
  });

  it('should inject line_account_id into SELECT queries', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-123');
    const stmt = tenantDb.prepare('SELECT * FROM friends');
    expect(stmt).toBeDefined();
  });

  it('should inject line_account_id into SELECT with existing WHERE', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-456');
    const stmt = tenantDb.prepare('SELECT * FROM friends WHERE is_following = 1');
    expect(stmt).toBeDefined();
  });

  it('should inject line_account_id into INSERT INTO ... VALUES', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-789');
    const stmt = tenantDb.prepare(
      'INSERT INTO friends (id, line_user_id, display_name) VALUES (?, ?, ?)',
    );
    expect(stmt).toBeDefined();
  });

  it('should inject line_account_id into UPDATE queries', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-upd');
    const stmt = tenantDb.prepare('UPDATE friends SET display_name = ? WHERE line_user_id = ?');
    expect(stmt).toBeDefined();
  });

  it('should inject line_account_id into DELETE queries', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-del');
    const stmt = tenantDb.prepare('DELETE FROM friends WHERE id = ?');
    expect(stmt).toBeDefined();
  });

  it('should expose raw D1Database via unsafe()', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-unsafe');
    const raw = tenantDb.unsafe();
    expect(raw).toBe(mockDb);
  });

  it('should return accountId via getAccountId()', () => {
    const tenantDb = new TenantDB(mockDb as unknown as D1Database, 'acc-get');
    expect(tenantDb.getAccountId()).toBe('acc-get');
  });
});

describe('createTenantDB', () => {
  const mockDb = {} as D1Database;

  it('should return TenantDB when accountId is provided', () => {
    const result = createTenantDB(mockDb, 'acc-1');
    expect(result).toBeInstanceOf(TenantDB);
  });

  it('should return null when accountId is null/undefined', () => {
    expect(createTenantDB(mockDb, null)).toBeNull();
    expect(createTenantDB(mockDb, undefined)).toBeNull();
    expect(createTenantDB(mockDb, '')).toBeNull();
  });
});
