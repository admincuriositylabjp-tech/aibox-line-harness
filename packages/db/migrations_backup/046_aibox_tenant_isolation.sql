-- 046_aibox_tenant_isolation.sql
-- AIBOX LINE Harness フォーク: テナント分離対応
-- 22 テーブルに line_account_id カラムを追加し、entry_routes の UNIQUE 制約を
-- (ref_code) → (ref_code, line_account_id) に変更する。
--
-- すべてのカラムは NULLABLE (DEFAULT NULL) とし、既存データとの互換性を保つ。
-- アプリケーションコードの移行が完了したら NOT NULL 化を別マイグレーションで行うこと。
--
-- 制約: SQLite は ALTER TABLE DROP CONSTRAINT をサポートしないため、
-- entry_routes はテーブル再作成パターン（CREATE → INSERT → DROP → RENAME）を使用する。
-- =============================================================================

-- =============================================================================
-- 1. entry_routes: UNIQUE 制約の修正 + line_account_id 追加
--    SQLite は ALTER TABLE DROP CONSTRAINT 不可 → テーブル再作成
-- =============================================================================

-- 現在の entry_routes 構造（003 + 038 の累積）:
--   id TEXT PRIMARY KEY,
--   ref_code TEXT UNIQUE NOT NULL,  ← これを UNIQUE(ref_code, line_account_id) に変更
--   name TEXT NOT NULL,
--   tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
--   scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
--   redirect_url TEXT,
--   is_active INTEGER NOT NULL DEFAULT 1,
--   pool_id TEXT REFERENCES traffic_pools(id) ON DELETE SET NULL,
--   intro_template_id TEXT REFERENCES message_templates(id) ON DELETE SET NULL,
--   run_account_friend_add_scenarios INTEGER NOT NULL DEFAULT 1,
--   created_at TEXT NOT NULL DEFAULT (datetime('now')),
--   updated_at TEXT NOT NULL DEFAULT (datetime('now'))

-- Step 1: 新しいテーブルを作成（UNIQUE(ref_code, line_account_id) に変更）
CREATE TABLE IF NOT EXISTS entry_routes_new (
  id                                TEXT PRIMARY KEY,
  ref_code                          TEXT NOT NULL,
  name                              TEXT NOT NULL,
  tag_id                            TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id                       TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  redirect_url                      TEXT,
  is_active                         INTEGER NOT NULL DEFAULT 1,
  pool_id                           TEXT REFERENCES traffic_pools (id) ON DELETE SET NULL,
  intro_template_id                 TEXT REFERENCES message_templates (id) ON DELETE SET NULL,
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


-- =============================================================================
-- 2. その他 29 テーブル: ALTER TABLE ADD COLUMN line_account_id TEXT
--    ※ entry_routes は既に上で処理済み（カウント外）
-- =============================================================================

-- ============================================================
-- GAP-01: Webhook 関連（2テーブル）
-- ============================================================
ALTER TABLE incoming_webhooks ADD COLUMN line_account_id TEXT;
ALTER TABLE outgoing_webhooks ADD COLUMN line_account_id TEXT;

-- ============================================================
-- GAP-02: Google Calendar 関連（2テーブル）
-- ============================================================
ALTER TABLE google_calendar_connections ADD COLUMN line_account_id TEXT;
ALTER TABLE calendar_bookings ADD COLUMN line_account_id TEXT;

-- ============================================================
-- GAP-03: テンプレート / スコアリング / 通知 / 決済 / 自動化ログ（6テーブル）
-- ============================================================
ALTER TABLE templates ADD COLUMN line_account_id TEXT;
ALTER TABLE scoring_rules ADD COLUMN line_account_id TEXT;
ALTER TABLE friend_scores ADD COLUMN line_account_id TEXT;
ALTER TABLE notification_rules ADD COLUMN line_account_id TEXT;
ALTER TABLE notifications ADD COLUMN line_account_id TEXT;
ALTER TABLE stripe_events ADD COLUMN line_account_id TEXT;
ALTER TABLE automation_logs ADD COLUMN line_account_id TEXT;

-- ============================================================
-- GAP-04: 流入経路 / トラッキング / フォーム 関連（6テーブル）
--   entry_routes は上で処理済み
-- ============================================================
ALTER TABLE ref_tracking ADD COLUMN line_account_id TEXT;
ALTER TABLE tracked_links ADD COLUMN line_account_id TEXT;
ALTER TABLE link_clicks ADD COLUMN line_account_id TEXT;
ALTER TABLE forms ADD COLUMN line_account_id TEXT;
ALTER TABLE form_submissions ADD COLUMN line_account_id TEXT;
ALTER TABLE form_opens ADD COLUMN line_account_id TEXT;

-- ============================================================
-- GAP-05: 広告 / スタッフ / メッセージテンプレート（5テーブル）
-- ============================================================
ALTER TABLE ad_platforms ADD COLUMN line_account_id TEXT;
ALTER TABLE ad_conversion_logs ADD COLUMN line_account_id TEXT;
ALTER TABLE staff_members ADD COLUMN line_account_id TEXT;
ALTER TABLE message_templates ADD COLUMN line_account_id TEXT;

-- ============================================================
-- Round 2 系: コンバージョン / アフィリエイト（4テーブル）
-- ============================================================
ALTER TABLE conversion_points ADD COLUMN line_account_id TEXT;
ALTER TABLE conversion_events ADD COLUMN line_account_id TEXT;
ALTER TABLE affiliates ADD COLUMN line_account_id TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN line_account_id TEXT;

-- ============================================================
-- 配信インサイト / リマインダ（4テーブル）
-- ============================================================
ALTER TABLE broadcast_insights ADD COLUMN line_account_id TEXT;
ALTER TABLE reminder_steps ADD COLUMN line_account_id TEXT;
ALTER TABLE friend_reminders ADD COLUMN line_account_id TEXT;
ALTER TABLE friend_reminder_deliveries ADD COLUMN line_account_id TEXT;


-- =============================================================================
-- 3. rich_menu_groups.account_id は命名不統一だが既存のためコメントのみ
--    account_id = REFERENCES line_accounts(id) → 機能的に同等
-- =============================================================================
-- rich_menu_groups.account_id: 既存。命名不統一（line_account_id が正だが
-- account_id として line_accounts(id) への FK を持つ）。変更しない。
