#!/usr/bin/env python3
"""Sign in with Apple（Web版OAuth）のクライアントシークレットJWTを生成する。

Supabase の Authentication > Providers > Apple にある
「Secret Key (for OAuth)」へ貼るための文字列を作る。

  必要なもの:
    - Apple Developer Portal で作った Key の .p8 ファイル
    - その Key ID（10文字）
    - Team ID（LP34H67XY3）
    - Services ID（com.arakawa-lab.ownnews.web）

  使い方:
    pip install pyjwt cryptography
    python3 scripts/gen_apple_secret.py \
        --p8 ~/Downloads/AuthKey_XXXXXXXXXX.p8 \
        --key-id XXXXXXXXXX \
        --team-id LP34H67XY3 \
        --services-id com.arakawa-lab.ownnews.web

  重要:
    - このJWTの有効期限は Apple の仕様で最長6ヶ月。切れるとWeb版の
      Appleログインが失敗するようになるため、期限前に再生成して
      Supabase に貼り直すこと（出力に期限を表示する）。
    - .p8 と生成したJWTは秘密情報。リポジトリにコミットしないこと。
    - このスクリプトは外部と通信しない（ローカルで署名するだけ）。
"""

import argparse
import datetime
import sys

try:
    import jwt  # PyJWT
except ImportError:
    sys.exit("pyjwt が必要です:  pip install pyjwt cryptography")

# Apple の上限は 15777000 秒（約6ヶ月）
MAX_LIFETIME_SEC = 15777000


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--p8", required=True, help="AuthKey_XXXXXXXXXX.p8 のパス")
    p.add_argument("--key-id", required=True, help="Key ID（10文字）")
    p.add_argument("--team-id", required=True, help="Team ID")
    p.add_argument("--services-id", required=True, help="Services ID（Webのclient_id）")
    args = p.parse_args()

    with open(args.p8, "r") as f:
        private_key = f.read()

    now = datetime.datetime.now(datetime.timezone.utc)
    exp = now + datetime.timedelta(seconds=MAX_LIFETIME_SEC)

    token = jwt.encode(
        {
            "iss": args.team_id,
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
            "aud": "https://appleid.apple.com",
            "sub": args.services_id,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": args.key_id},
    )

    print("\n=== Supabase の Secret Key (for OAuth) に貼る文字列 ===\n")
    print(token)
    print(f"\n有効期限: {exp.isoformat()}  ← この日までに再生成が必要\n")


if __name__ == "__main__":
    main()
