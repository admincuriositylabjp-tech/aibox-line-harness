'use client'

import { useState } from 'react'
import { publicApi } from '@/lib/api'

type Step = 'clinic' | 'line-oa' | 'line-login' | 'confirm' | 'complete'

interface FormData {
  name: string
  adminName: string
  channelId: string
  channelAccessToken: string
  channelSecret: string
  loginChannelId: string
  loginChannelSecret: string
  liffId: string
}

interface RegisterResult {
  accountId: string
  accountName: string
  apiKey: string
  webhookConfigured: boolean
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>('clinic')
  const [form, setForm] = useState<FormData>({
    name: '',
    adminName: '',
    channelId: '',
    channelAccessToken: '',
    channelSecret: '',
    loginChannelId: '',
    loginChannelSecret: '',
    liffId: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RegisterResult | null>(null)

  const update = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleRegister = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await publicApi.onboarding.register({
        name: form.name,
        channelId: form.channelId,
        channelAccessToken: form.channelAccessToken,
        channelSecret: form.channelSecret || undefined,
        adminName: form.adminName,
        loginChannelId: form.loginChannelId || undefined,
        loginChannelSecret: form.loginChannelSecret || undefined,
        liffId: form.liffId || undefined,
      })

      if (!res.success || !res.data) {
        setError(res.error || '登録に失敗しました')
        setLoading(false)
        return
      }

      setResult({
        accountId: res.data.account.id,
        accountName: res.data.account.name,
        apiKey: res.data.admin.apiKey,
        webhookConfigured: res.data.webhook.configured,
      })
      setStep('complete')
    } catch (err) {
      setError(`通信エラー: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const isStepValid = (): boolean => {
    switch (step) {
      case 'clinic':
        return form.name.trim().length > 0 && form.adminName.trim().length > 0
      case 'line-oa':
        return form.channelId.trim().length > 0 && form.channelAccessToken.trim().length > 0
      case 'line-login':
        return true // すべて任意入力
      case 'confirm':
        return true
      default:
        return false
    }
  }

  const nextStep = () => {
    switch (step) {
      case 'clinic': setStep('line-oa'); break
      case 'line-oa': setStep('line-login'); break
      case 'line-login': setStep('confirm'); break
    }
  }

  const prevStep = () => {
    switch (step) {
      case 'line-oa': setStep('clinic'); break
      case 'line-login': setStep('line-oa'); break
      case 'confirm': setStep('line-login'); break
    }
  }

  // Step progress indicator
  const steps = [
    { key: 'clinic' as Step, label: '基本情報' },
    { key: 'line-oa' as Step, label: 'LINE設定' },
    { key: 'line-login' as Step, label: 'ログイン設定' },
    { key: 'confirm' as Step, label: '確認' },
  ]
  const currentIdx = steps.findIndex(s => s.key === step)

  // ─── Complete Step ──────────────────────────────────────────────────
  if (step === 'complete' && result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">登録完了</h1>
            <p className="text-gray-600 mt-2">
              「{result.accountName}」のオンボーディングが完了しました。
            </p>
          </div>

          {/* API Key — 一度だけ表示 */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-amber-800 mb-2">
              ⚠️ APIキー — 今すぐ保存してください
            </h3>
            <p className="text-xs text-amber-700 mb-3">
              このキーは<strong>二度と表示されません</strong>。管理画面へのログインに必要です。
              安全な場所にコピーしてから閉じてください。
            </p>
            <div className="bg-white border border-amber-300 rounded p-3 mb-3">
              <code className="text-sm break-all font-mono">{result.apiKey}</code>
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(result.apiKey)}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              クリップボードにコピー
            </button>
          </div>

          <div className="flex gap-2 text-sm text-gray-600 mb-6">
            <span className={`px-2 py-1 rounded ${result.webhookConfigured ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              Webhook: {result.webhookConfigured ? '✅ 自動設定済み' : '❌ 手動設定が必要'}
            </span>
          </div>

          <a
            href="/login"
            className="block w-full px-4 py-3 bg-[#06C755] text-white rounded-lg text-sm font-medium text-center hover:opacity-90 transition-opacity"
          >
            管理画面にログイン
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">LINEアカウント連携 設定</h1>
          <p className="text-gray-600 mt-2 text-sm">
            あなたのLINE公式アカウントをAIBOXに接続します
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                i <= currentIdx
                  ? 'bg-[#06C755] text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}>
                {i + 1}
              </div>
              <span className={`ml-2 text-sm ${i <= currentIdx ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className={`w-8 h-0.5 mx-2 ${i < currentIdx ? 'bg-[#06C755]' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* ─── Step: Clinic Info ─────────────────────────────────────────── */}
        {step === 'clinic' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">クリニック基本情報</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">クリニック名</label>
                <input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="例: 〇〇整骨院"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">管理者名</label>
                <input
                  value={form.adminName}
                  onChange={(e) => update('adminName', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="例: 山田太郎"
                  required
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── Step: LINE OA Config ────────────────────────────────────── */}
        {step === 'line-oa' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">LINE公式アカウント設定</h2>
            <p className="text-sm text-gray-600 mb-4">
              LINE Developersコンソールからコピーした情報を入力してください。
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Channel ID <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.channelId}
                  onChange={(e) => update('channelId', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="1234567890"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Channel Access Token <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.channelAccessToken}
                  onChange={(e) => update('channelAccessToken', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="アクセストークン（long-lived）"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Channel Secret
                </label>
                <input
                  value={form.channelSecret}
                  onChange={(e) => update('channelSecret', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="チャネルシークレット（任意）"
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── Step: LINE Login Config ─────────────────────────────────── */}
        {step === 'line-login' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">LINEログイン設定（任意）</h2>
            <p className="text-sm text-gray-600 mb-4">
              予約機能でLINEログインを使用する場合に設定します。今は空欄でも後から設定可能です。
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Login Channel ID</label>
                <input
                  value={form.loginChannelId}
                  onChange={(e) => update('loginChannelId', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="LINE Login用Channel ID（任意）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Login Channel Secret</label>
                <input
                  value={form.loginChannelSecret}
                  onChange={(e) => update('loginChannelSecret', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="LINE Login用Channel Secret（任意）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">LIFF ID</label>
                <input
                  value={form.liffId}
                  onChange={(e) => update('liffId', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="LIFFアプリID（任意）"
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── Step: Confirm ────────────────────────────────────────────── */}
        {step === 'confirm' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">入力内容の確認</h2>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-gray-500">クリニック名</span>
                <span className="font-medium">{form.name}</span>
                <span className="text-gray-500">管理者名</span>
                <span className="font-medium">{form.adminName}</span>
                <span className="text-gray-500">Channel ID</span>
                <span className="font-mono text-xs">{form.channelId}</span>
                <span className="text-gray-500">Login Channel ID</span>
                <span className="font-mono text-xs">{form.loginChannelId || '（未設定）'}</span>
                <span className="text-gray-500">LIFF ID</span>
                <span className="font-mono text-xs">{form.liffId || '（未設定）'}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4">
              送信すると、LINE公式アカウントの自動検証とWebhook設定が行われます。
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
          {step !== 'clinic' ? (
            <button
              onClick={prevStep}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              戻る
            </button>
          ) : (
            <div />
          )}

          {step !== 'confirm' ? (
            <button
              onClick={nextStep}
              disabled={!isStepValid()}
              className="px-6 py-2 bg-[#06C755] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              次へ
            </button>
          ) : (
            <button
              onClick={handleRegister}
              disabled={loading}
              className="px-8 py-2 bg-[#06C755] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? '登録中...' : '登録する'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
