import { Hono } from 'hono';
import { createLineAccount, createStaffMember, getLineAccountById } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
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

// Set webhook endpoint URL for a LINE account
// Best-effort: returns success/failure but doesn't throw
async function setupWebhook(
  accessToken: string,
  workerUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new LineClient(accessToken);
    await client.setWebhookEndpointUrl(`${workerUrl}/webhook`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Webhook setup failed: ${err}` };
  }
}

// POST /api/onboarding/register
// 新規テナント（整体院）が自前のLINE公式アカウントを登録するエンドポイント。
// line_accounts + staff_members（owner権限）を一括作成＋Webhook自動設定。
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
      loginChannelId?: string;     // LINE Login channel ID（LIFF認証用）
      loginChannelSecret?: string; // LINE Login channel secret
      liffId?: string;             // LIFF ID（LIFFアプリ用）
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
      loginChannelId: body.loginChannelId,
      loginChannelSecret: body.loginChannelSecret,
      liffId: body.liffId,
    });

    // 2) staff_members 作成（owner権限）
    const admin = await createStaffMember(db, {
      name: body.adminName,
      role: 'owner',
      lineAccountId: account.id,
    });

    // 3) Webhook自動設定（ベストエフォート）
    let webhookResult: { ok: boolean; error?: string } | null = null;
    if (c.env.WORKER_URL) {
      webhookResult = await setupWebhook(body.channelAccessToken, c.env.WORKER_URL);
    } else {
      webhookResult = { ok: false, error: 'WORKER_URL not configured' };
    }

    return c.json({
      success: true,
      data: {
        account: {
          id: account.id,
          name: account.name,
          channelId: account.channel_id,
          loginChannelId: account.login_channel_id,
          liffId: account.liff_id,
        },
        admin: {
          id: admin.id,
          name: admin.name,
          role: admin.role,
          apiKey: admin.api_key,  // 初回のみ返す、二度と取得不可。管理者はこのキーを安全に保管する。
        },
        webhook: {
          configured: webhookResult.ok,
          error: webhookResult.error || null,
        },
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/onboarding/register error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/onboarding/:accountId/setup-webhook
// 既存accountのWebhook設定を再実行（エラー時リカバリ用）
// 認証なし（accountIdを知っている人のみアクセス可能）
onboarding.post('/api/onboarding/:accountId/setup-webhook', async (c) => {
  try {
    const accountId = c.req.param('accountId');
    const account = await getLineAccountById(c.env.DB, accountId);
    if (!account) {
      return c.json({ success: false, error: 'Account not found' }, 404);
    }

    const workerUrl = c.env.WORKER_URL;
    if (!workerUrl) {
      return c.json({ success: false, error: 'WORKER_URL not configured' }, 500);
    }

    const result = await setupWebhook(account.channel_access_token, workerUrl);
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, 500);
    }

    return c.json({ success: true, data: { webhookUrl: `${workerUrl}/webhook` } });
  } catch (err) {
    console.error('POST /api/onboarding/:accountId/setup-webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/onboarding/health — オンボーディングサービス稼働確認
onboarding.get('/api/onboarding/health', async (c) => {
  return c.json({ success: true, data: { status: 'ok', service: 'onboarding' } });
});

export { onboarding };