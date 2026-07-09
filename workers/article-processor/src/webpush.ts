// Web Push 送信（VAPID署名のみ・ペイロードなし）
// ペイロードを暗号化せず「空プッシュ」を送る。Service Worker側で固定文言 or
// /api/latest を取得して通知を表示するので、payload暗号化(aes128gcm)は不要。
// これによりWorker側の暗号処理を最小化している。

function b64urlToBytes(b64url: string): Uint8Array {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4)
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

function bytesToB64url(bytes: Uint8Array): string {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** VAPID公開鍵(65byte)からx,yを取り出し、秘密鍵dと合わせて署名用CryptoKeyを作る */
async function importVapidKey(publicKeyB64url: string, privateKeyB64url: string): Promise<CryptoKey> {
    const pub = b64urlToBytes(publicKeyB64url)   // 0x04 || X(32) || Y(32)
    const d = privateKeyB64url
    const x = bytesToB64url(pub.slice(1, 33))
    const y = bytesToB64url(pub.slice(33, 65))
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x, y, d, ext: true }
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** VAPID JWT (ES256) を生成する */
async function signVapidJwt(audience: string, subject: string, key: CryptoKey, nowSec: number): Promise<string> {
    const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
    const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({
        aud: audience,
        exp: nowSec + 12 * 60 * 60,  // 12時間有効
        sub: subject,
    })))
    const signingInput = `${header}.${payload}`
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(signingInput)
    )
    // Web CryptoのECDSAは raw r||s (64byte) を返す = JWS ES256 と互換
    return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`
}

export interface PushSubscription {
    endpoint: string
    p256dh: string
    auth: string
}

export interface VapidConfig {
    publicKey: string
    privateKey: string
    subject: string   // 例: "mailto:you@example.com"
}

/**
 * 1件の購読へ空プッシュを送る。
 * 戻り値: 'ok' | 'gone'(購読失効=削除すべき) | 'error'
 */
export async function sendPush(
    sub: PushSubscription,
    vapid: VapidConfig,
    nowSec: number,
): Promise<'ok' | 'gone' | 'error'> {
    try {
        const audience = new URL(sub.endpoint).origin
        const key = await importVapidKey(vapid.publicKey, vapid.privateKey)
        const jwt = await signVapidJwt(audience, vapid.subject, key, nowSec)

        const res = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `vapid t=${jwt}, k=${vapid.publicKey}`,
                'TTL': '86400',           // 1日
                'Urgency': 'normal',
                'Content-Length': '0',
            },
        })
        if (res.status === 404 || res.status === 410) return 'gone'  // 失効
        if (res.ok || res.status === 201) return 'ok'
        console.error(`Push failed ${res.status} for ${sub.endpoint.slice(0, 40)}`)
        return 'error'
    } catch (e) {
        console.error('sendPush error:', e)
        return 'error'
    }
}
