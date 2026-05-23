-- 046_aibox_tenant_isolation.sql
-- AIBOX LINE Harness フォーク: テナント分離対応
-- entry_routes の UNIQUE 制約を (ref_code) → (ref_code, line_account_id) に変更する。
-- SQLite は ALTER TABLE DROP CONSTRAINT をサポートしないため、
-- テーブル再作成パターン（CREATE → INSERT → DROP → RENAME）を使用する。

-- Step 1: 新しいテーブルを作成（UNIQUE(ref_code, line_account_id) に変更）
CREATE TABLE IF NOT EXISTS entry_routes_new (
  id                                TEXT PRIMARY KEY,
  ref_code                          TEXT NOT NULL,
  name                              TEXT NOT NULL,
  tag_id                            TEXT REFERENCES tags(id) ON DELETE SET NULL,
  scenario_id                       TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  redirect_url                      TEXT,
  is_active                         INTEGER NOT NULL DEFAULT 1,
  pool_id                           TEXT REFERENCES traffic_pools(id) ON DELETE SET NULL,
  intro_template_id                 TEXT REFERENCES message_templates(id) ON DELETE SET NULL,
  run_account_friend_add_scenarios  INTEGER NOT NULL DEFAULT 1,
  line_account_id                   TEXT,
  created_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ref_code, line_account_id)
);

-- Step 2: 既存データを新しいテーブルにコピー
INSERT INTO entry_routes_new (
  id, ref_code, name, tag_id, scenario_id, redirect_url,
  is_active, pool_id, intro_template_id, run_account_friend_add_scenarios,
  line_account_id, created_at, updated_at
)
SELECT
  id, ref_code, name, tag_id, scenario_id, redirect_url,
  is_active, pool_id, intro_template_id, run_account_friend_add_scenarios,
  NULL, created_at, updated_at
FROM entry_routes;

-- Step 3: 古いテーブルを削除
DROP TABLE entry_routes;

-- Step 4: 新しいテーブルを正規名にリネーム
ALTER TABLE entry_routes_new RENAME TO entry_routes;

-- Step 5: INDEX を再作成
CREATE INDEX IF NOT EXISTS idx_entry_routes_ref ON entry_routes (ref_code);
CREATE INDEX IF NOT EXISTS idx_entry_routes_pool ON entry_routes (pool_id);
CREATE INDEX IF NOT EXISTS idx_entry_routes_account ON entry_routes (line_account_id);
