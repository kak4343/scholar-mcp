# scholar-mcp (日本語)

> **PubMed + arXiv + Semantic Scholar** を 1 つの MCP tool で横断検索する Claude Code / Claude Desktop 用サーバ。v0.2 で 2 段キャッシュと Notion 直投入を追加。

日本人医師・研究者が Claude Code 上で文献調査を完結できるよう設計した OSS。日常診療で「あの論文どこだっけ」となったとき、Claude に話しかけるだけで 3 ソース横断検索が走り、結果をそのまま Notion Knowledge DB に積めるところまでが射程。

## なぜ作ったか

- 既存 MCP server は単一ソース (PubMed 単独 / arXiv 単独) で、横断検索する場合は tool を 3 回呼び分ける必要がある
- 横断統合 + キャッシュ + Notion 連携まで揃った OSS が見当たらない
- 医師 × Claude Code 開発者という二重ドメインからの差別化

## インストール

```bash
npm install -g scholar-mcp
```

または `npx` で都度起動:

```bash
npx scholar-mcp
```

## Claude Desktop / Claude Code への設定

```json
{
  "mcpServers": {
    "scholar": {
      "command": "npx",
      "args": ["scholar-mcp"],
      "env": {
        "PUBMED_API_KEY": "任意、NCBI のレート上限を緩和",
        "SEMANTIC_SCHOLAR_API_KEY": "任意、レート上限を緩和",
        "NOTION_TOKEN": "任意、scholar_export_to_notion を使う場合のみ必須"
      }
    }
  }
}
```

## 提供する Tool

### `scholar_search`

```typescript
{
  query: string;                    // 例: "diabetic retinopathy SGLT2"
  sources?: ("pubmed" | "arxiv" | "semantic_scholar")[];  // 既定: 3 つすべて
  max_results?: number;             // 既定 10 (1 ソースあたり)、最大 50
  date_from?: string;               // YYYY-MM-DD
  date_to?: string;                 // YYYY-MM-DD
}
```

戻り値は統一スキーマの JSON。各結果に source / title / authors / abstract / DOI / PMID / arXiv ID / published_date / venue / citation_count (Semantic Scholar のみ) / url が含まれる。あわせて `cache_hit` (boolean) と `cache_hit_rate` (0.0-1.0、プロセス起動以来の累計ヒット率) も返す。

### `scholar_export_to_notion` (v0.2 で追加)

検索結果を Notion DB にそのまま投入する。

```typescript
{
  results: SearchResult[];           // scholar_search の戻り値
  notion_database_id: string;        // UUID (ハイフンあり/なし両方可)
  notion_token?: string;             // 環境変数より優先
  include_japanese_summary?: boolean;  // 既定 false
  dry_run?: boolean;                 // 既定 false。true で API を叩かず payload だけ返す
}
```

投入される Notion page のプロパティ (DB 側に定義が必要):

- `Title` (title) — タイトル
- `Authors` (rich_text) — 著者リスト
- `DOI` (url) — `https://doi.org/...` 形式に正規化
- `Source` (select) — `pubmed` / `arxiv` / `semantic_scholar`
- `Published` (date) — 出版日
- `Venue` (rich_text) — Journal / conference
- `Citation Count` (number) — Semantic Scholar の引用数
- `Abstract` (rich_text、2000 文字でトリム、超過分は body block に書き出し)
- `Japanese Summary` (rich_text、`include_japanese_summary: true` のときのみ)
- `Status` (select) — 既定 `To Read`

1 件失敗しても他は投入される (per-result エラーは戻り値の `pages[i].error` に格納)。

## キャッシュ (v0.2 で追加)

`scholar_search` は 2 段キャッシュを持つので、同じクエリを連続で叩いてもネットワークに行かない。

- **Memory cache:** `lru-cache`、1000 entry、TTL 1 時間
- **Disk cache:** SQLite (`better-sqlite3`)、`~/.scholar-mcp/cache/scholar_cache.db`、TTL 7 日
- **Cache key:** `sha256(JSON.stringify({tool, query, sources, date_from, date_to, max_results}))`。query は小文字化、sources はソート済なので意味的に同じリクエストは同じキーに正規化される
- **Promotion:** disk hit は自動で memory に昇格
- **報告:** 毎回の応答に `cache_hit_rate` を含める

ディスクキャッシュを丸ごと消す場合:

```bash
rm -rf ~/.scholar-mcp/cache/
```

## Notion トークンの読み込み順

`scholar_export_to_notion` は以下の順で Notion integration token を解決する。

1. tool 引数の `notion_token`
2. 環境変数 `NOTION_TOKEN`
3. `~/.scholar-mcp/config.json` の `{ "notion_token": "secret_..." }`

Notion 側では integration を対象 DB に「接続」する必要がある (Notion DB のページ右上 ・・・ メニュー → Connections)。

スキーマは作者個人の Knowledge DB (`data_source_id: 0a489d15-83e8-471d-ba1e-f04030473967`) と互換にしているので、同じ DB を `scholar-mcp` と既存 Python (例: 眼科週次レビューの `push_to_notion.py`) の両方から書き込める。

## API キー

- **PubMed (任意):** https://www.ncbi.nlm.nih.gov/account/ で無料発行、レート 3 req/s → 10 req/s
- **Semantic Scholar (強く推奨):** https://www.semanticscholar.org/product/api で無料発行。キー無しだと全世界共有 rate pool で頻繁に HTTP 429 が出る。個人キーで専用 1 req/s が得られる。
- **arXiv:** API キー不要
- **Notion:** https://www.notion.so/profile/integrations で無料発行、`scholar_export_to_notion` を使う場合のみ必須

## 開発

```bash
git clone https://github.com/kak4343/scholar-mcp
cd scholar-mcp
npm install
npm run build
npm start
```

簡易スモークテスト (cache hit/miss + Notion dry-run スキーマ確認):

```bash
node scripts/smoke_test.mjs
```

## ロードマップ

- **v0.1:** 3 ソース横断 `scholar_search`
- **v0.2 (現行):** 2 段キャッシュ + `scholar_export_to_notion`
- **v0.3:** 日本語クエリの自動英訳 + 結果の日本語要約 (Anthropic Claude API 経由、optional)
- **v0.4:** `scholar_get_related` (Semantic Scholar の引用グラフ)
- **v0.5:** open access 論文の全文取得

## 法令・倫理上の注意

- 取得対象は **公開済みのメタデータ + abstract のみ**。全文取得は v0.5 で open access のみ対応予定。
- すべての結果に出典 URL を含むので、引用時はそちらを参照のこと。
- **患者情報・症例情報は絶対にクエリに入れないこと。** 作者個人のプロジェクト規約 (患者情報をクラウドに送らない) と整合し、同じ規約を利用者にもお願いしている。

## ライセンス

MIT

## 作者

Claude Code を日常的に診療補助に使っている眼科医。Issue / PR 歓迎。
