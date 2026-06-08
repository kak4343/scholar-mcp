# scholar-mcp

> Unified MCP server for **PubMed + arXiv + Semantic Scholar** scholarly search.

Search three major scholarly databases from a single MCP tool call, returning unified results (title, authors, abstract, DOI, publication date, citation count, venue, URL).

## Why?

Existing MCP servers cover a single source (PubMed-only, arXiv-only). For clinicians and researchers doing cross-disciplinary literature reviews, calling three separate tools is friction. `scholar-mcp` is one tool, three sources, unified schema.

## Install

```bash
npm install -g scholar-mcp
```

Or run via `npx` without install:

```bash
npx scholar-mcp
```

## Configure in Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "scholar": {
      "command": "npx",
      "args": ["scholar-mcp"],
      "env": {
        "PUBMED_API_KEY": "optional, raises NCBI rate limit",
        "SEMANTIC_SCHOLAR_API_KEY": "optional, raises rate limit"
      }
    }
  }
}
```

## Tool: `scholar_search`

```typescript
{
  query: string;                    // e.g. "diabetic retinopathy SGLT2"
  sources?: ("pubmed" | "arxiv" | "semantic_scholar")[];  // default: all
  max_results?: number;             // default 10 per source, max 50
  date_from?: string;               // YYYY-MM-DD
  date_to?: string;                 // YYYY-MM-DD
}
```

Returns a unified JSON object with `results` array containing each paper's source, title, authors, abstract, DOI/PMID/arXiv ID, publication date, venue, citation count (Semantic Scholar only), and URL.

## API keys (optional, but recommended)

- **PubMed**: free at https://www.ncbi.nlm.nih.gov/account/ — raises rate limit from 3 req/s to 10 req/s
- **Semantic Scholar**: free at https://www.semanticscholar.org/product/api — raises rate limit
- **arXiv**: no API key needed

Set them via environment variables `PUBMED_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY`.

## Development

```bash
git clone https://github.com/kakedashi-eyedoc/scholar-mcp
cd scholar-mcp
npm install
npm run build
npm start
```

## Roadmap

- **v0.1** (current): `scholar_search` unified across 3 sources
- **v0.2**: per-source caching (memory + disk), `scholar_get_related` tool
- **v0.3**: optional Japanese query auto-translation, Japanese abstract summarization (via Anthropic Claude API)
- **v0.4**: `scholar_export_to_notion` tool (push results to a Notion database)
- **v0.5**: full-text retrieval for open-access papers

## License

MIT

## Author

Built by a physician using Claude Code for daily literature review. Issues and PRs welcome.
