# scholar-mcp

> Unified MCP server for **PubMed + arXiv + Semantic Scholar** scholarly search, with two-tier caching and one-call Notion export.

Search three major scholarly databases from a single MCP tool call, returning unified results (title, authors, abstract, DOI, publication date, citation count, venue, URL). Push any result set straight into a Notion database with a second call.

## Why?

Existing MCP servers cover a single source (PubMed-only, arXiv-only). For clinicians and researchers doing cross-disciplinary literature reviews, calling three separate tools is friction. `scholar-mcp` is one tool, three sources, unified schema, with caching that makes follow-up queries instant.

## Install

```bash
npm install -g scholar-mcp
```

Or run via `npx` without install:

```bash
npx @kak4343/scholar-mcp
```

## Configure in Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "scholar": {
      "command": "npx",
      "args": ["@kak4343/scholar-mcp"],
      "env": {
        "PUBMED_API_KEY": "optional, raises NCBI rate limit",
        "SEMANTIC_SCHOLAR_API_KEY": "optional, raises rate limit",
        "NOTION_TOKEN": "optional, required only for scholar_export_to_notion"
      }
    }
  }
}
```

## Tools

### `scholar_search`

```typescript
{
  query: string;                    // e.g. "diabetic retinopathy SGLT2"
  sources?: ("pubmed" | "arxiv" | "semantic_scholar")[];  // default: all
  max_results?: number;             // default 10 per source, max 50
  date_from?: string;               // YYYY-MM-DD
  date_to?: string;                 // YYYY-MM-DD
}
```

Returns a unified JSON object with `results` array containing each paper's source, title, authors, abstract, DOI/PMID/arXiv ID, publication date, venue, citation count (Semantic Scholar only), and URL. Also returns `cache_hit` (boolean) and `cache_hit_rate` (0.0-1.0).

### `scholar_export_to_notion` (v0.2)

Push a result set into a Notion database in one call.

```typescript
{
  results: SearchResult[];           // output of scholar_search
  notion_database_id: string;        // UUID, with or without dashes
  notion_token?: string;             // overrides NOTION_TOKEN env
  include_japanese_summary?: boolean;  // default false
  dry_run?: boolean;                 // default false, build payload only
}
```

Each Notion page is created with these properties (the database must define them):

- `Title` (title)
- `Authors` (rich_text)
- `DOI` (url, normalised to `https://doi.org/...`)
- `Source` (select: `pubmed` / `arxiv` / `semantic_scholar`)
- `Published` (date)
- `Venue` (rich_text)
- `Citation Count` (number)
- `Abstract` (rich_text, truncated at 2000 chars; the full abstract is also written as body blocks)
- `Japanese Summary` (rich_text, only when `include_japanese_summary: true` and the field exists)
- `Status` (select: defaults to `To Read`)

Errors are captured per result so a single bad row never aborts the batch.

## Caching (v0.2)

`scholar_search` is backed by a two-tier cache so repeated queries are free.

- **Memory:** `lru-cache`, 1000 entries, 1-hour TTL
- **Disk:** SQLite (`better-sqlite3`) at `~/.scholar-mcp/cache/scholar_cache.db`, 7-day TTL
- **Key:** `sha256(JSON.stringify({tool, query, sources, date_from, date_to, max_results}))` — query is lower-cased and sources are sorted, so semantically identical requests share a cache entry
- **Promotion:** disk hits are promoted back into memory automatically
- **Reporting:** every response includes `cache_hit_rate` (lifetime hit rate of the running process)

To wipe the on-disk cache: `rm -rf ~/.scholar-mcp/cache/`.

## Notion configuration

`scholar_export_to_notion` looks up the Notion integration token in this order:

1. `notion_token` argument to the tool call
2. `NOTION_TOKEN` environment variable
3. `~/.scholar-mcp/config.json` — `{ "notion_token": "secret_..." }`

Your Notion integration must be added to the target database (the integration's "Connections" must include that page). The schema above is intentionally compatible with the maintainer's personal Knowledge database (`data_source_id: 0a489d15-83e8-471d-ba1e-f04030473967`), so the same Notion DB can be populated by either `scholar-mcp` or by Python pipelines built around it.

## API keys

- **PubMed** (optional): free at https://www.ncbi.nlm.nih.gov/account/ — raises rate limit from 3 req/s to 10 req/s
- **Semantic Scholar** (**strongly recommended**): free at https://www.semanticscholar.org/product/api — without a key, requests share a global rate pool that is frequently saturated (HTTP 429). A personal key gives you a dedicated 1 req/s.
- **arXiv**: no API key needed
- **Notion**: free integration token at https://www.notion.so/profile/integrations — required only for `scholar_export_to_notion`

Set them via the environment variables `PUBMED_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`, and `NOTION_TOKEN`.

## Development

```bash
git clone https://github.com/kak4343/scholar-mcp
cd scholar-mcp
npm install
npm run build
npm start
```

Quick smoke test (cache hit/miss + Notion dry-run schema):

```bash
node scripts/smoke_test.mjs
```

## Roadmap

- **v0.1**: `scholar_search` unified across 3 sources
- **v0.2 (current)**: two-tier cache (LRU memory + SQLite disk), `scholar_export_to_notion`
- **v0.3**: optional Japanese query auto-translation, Japanese abstract summarization (via Anthropic Claude API)
- **v0.4**: `scholar_get_related` tool (Semantic Scholar citation graph)
- **v0.5**: full-text retrieval for open-access papers

## Legal / ethical notes

- Only publicly indexed paper metadata and abstracts are retrieved (full text is open-access only and reserved for v0.5).
- Cite the original source in any downstream use; every result includes a canonical URL.
- Do not paste patient-identifying information into queries — the maintainer's project policy forbids sending such data to any cloud service, and the same applies here.

## License

MIT

## Author

Built by a physician using Claude Code for daily literature review. Issues and PRs welcome.
