-- 未使用のベクトル検索インデックスとRPCを削除（DBサイズ超過対策 2026-08-02）
--
-- 経緯: 推薦エンジンをクライアント側（端末内コサイン類似度）に移行した際、
-- サーバ側ベクトル検索 match_articles_m3 の呼び出しは全て消えたが、
-- ivfflatインデックスだけが残り 1.14GB を占有していた
-- （無料枠500MBの445%超過の主因。Web/Workerともに参照ゼロをgrepで確認済み）。
--
-- DROP INDEX はインデックスファイルを物理削除するため、実行後すぐに
-- Database Size に反映される。

DROP INDEX IF EXISTS articles_embedding_m3_idx;

-- インデックスとセットで作られたサーバ側検索RPC（呼び出し元なし）
DROP FUNCTION IF EXISTS match_articles_m3(vector(1024), int);
