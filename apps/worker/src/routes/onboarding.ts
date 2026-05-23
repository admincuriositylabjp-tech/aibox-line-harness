import { Hono } from 'hono';
import { createLineAccount, createStaffMember } from '@line-crm/db';
import type { Env } from '../index.js';

const onboarding = new Hono<Env>();

// Verify LINE access token by fetching bot profile
async function verifyLineCredentials(accessToken: string): Promise<{ ok: boolean; profile?: { displayName: string }; error?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `LINE API error ${res.status}: ${text}` };
    }
    const data = await res.json() as { displayName?: string };
    return { ok: true, profile: { displayName: data.displayName || 'Unknown' } };
  } catch (err) {
    return { ok: false, error: `LINE API unreachable: ${err}` };
  }
}

// POST /api/onboarding/register
// 新規テナント（整体院）が自前のLINE公式アカウントを登録するエンドポイント。
// line_accounts + staff_members（owner権限）を一括作成する。
// 認証不要（新規登録のため）。
onboarding.post('/api/onboarding/register', async (c) => {
  try {
    const db = c.env.DB;
    const body = await c.req.json<{
      name: string;                // クリニック名 / アカウント名
      channelId: string;           // LINE OA channel ID
      channelAccessToken: string;  // LINE OA channel access token
      channelSecret?: string;      // LINE OA channel secret
      adminName: string;           // 管理者の氏名
    }>();

    // バリデーション
    if (!body.name || !body.channelId || !body.channelAccessToken || !body.adminName) {
      return c.json({
        success: false,
        error: 'name, channelId, channelAccessToken, adminName are required',
      }, 400);
    }

    // 重複チェック: 同一channel_idが既に登録されているか
    const existing = await db
      .prepare('SELECT id, name FROM line_accounts WHERE channel_id = ? AND is_active = 1')
      .bind(body.channelId)
      .first<{ id: string; name: string }>();
    if (existing) {
      return c.json({
        success: false,
        error: `LINE account with channelId ${body.channelId} is already registered as "${existing.name}"`,
      }, 409);
    }

    // アクセストークンの検証（LINE Bot Info API）
    const verification = await verifyLineCredentials(body.channelAccessToken);
    if (!verification.ok) {
      return c.json({
        success: false,
        error: `Credentials verification failed: ${verification.error}`,
      }, 400);
    }

    // 1) line_accounts 作成
    const account = await createLineAccount(db, {
      channelId: body.channelId,
      name: body.name,
      channelAccessToken: body.channelAccessToken,
      channelSecret: body.channelSecret || '',
    });

    // 2) staff_members 作成（owner権限）
    const admin = await createStaffMember(db, {
      name: body.adminName,
      role: 'owner',
      lineAccountId: account.id,
    });

    return c.json({
      success: true,
      data: {
        account: {
          id: account.id,
          name: account.name,
          channelId: account.channel_id,
        },
        admin: {
          id: admin.id,
          name: admin.name,
          role: admin.role,
          apiKey: admin.api_key,  // 初回のみ返す、二度と取得不可。管理者はこのキーを安全に保管する。
        },
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/onboarding/register error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/onboarding/health — オンボーディングサービス稼働確認
onboarding.get('/api/onboarding/health', async (c) => {
  return c.json({ success: true, data: { status: 'ok', service: 'onboarding' } });
});

export { onboarding };
