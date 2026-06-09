#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PubMedSearcher } from "./sources/pubmed.js";
import { ArxivSearcher } from "./sources/arxiv.js";
import { SemanticScholarSearcher } from "./sources/semantic_scholar.js";
import { SearchCache, buildCacheKey } from "./cache/index.js";
import { exportResultsToNotion } from "./notion/push.js";
import type { Source, SearchParams, SearchResult } from "./types.js";

const PUBMED_API_KEY = process.env.PUBMED_API_KEY;
const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

const pubmed = new PubMedSearcher(PUBMED_API_KEY);
const arxiv = new ArxivSearcher();
const semantic = new SemanticScholarSearcher(SEMANTIC_SCHOLAR_API_KEY);

interface CachedPayload {
  query: string;
  sources_queried: Source[];
  total_results: number;
  results: SearchResult[];
}

const searchCache = new SearchCache<CachedPayload>();

const server = new Server(
  { name: "scholar-mcp", version: "0.3.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "scholar_search",
      description:
        "Search PubMed, arXiv, and Semantic Scholar for scholarly papers. Returns title, authors, abstract, DOI, publication date, and venue. Supports date filtering and per-source filtering. Results are cached in memory (1h TTL) and on disk (7 days, ~/.scholar-mcp/cache/) keyed by sha256 of the request.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (English recommended for accuracy)",
          },
          sources: {
            type: "array",
            items: { type: "string", enum: ["pubmed", "arxiv", "semantic_scholar"] },
            description: "Sources to search (default: all three)",
          },
          max_results: {
            type: "number",
            description: "Maximum results per source (default 10, max 50)",
          },
          date_from: { type: "string", description: "Filter by publication date (YYYY-MM-DD)" },
          date_to: { type: "string", description: "Filter by publication date (YYYY-MM-DD)" },
        },
        required: ["query"],
      },
    },
    {
      name: "scholar_export_to_notion",
      description:
        "Push scholar_search results into a Notion database. Compatible with the user's Knowledge DB schema: Title (title), Authors (rich_text), DOI (url), Source (select), Published (date), Venue (rich_text), Citation Count (number), Abstract (rich_text), Japanese Summary (rich_text, optional), Status (select). Reads NOTION_TOKEN from env or ~/.scholar-mcp/config.json. Set dry_run=true to build the page payloads without calling the Notion API.",
      inputSchema: {
        type: "object",
        properties: {
          results: {
            type: "array",
            description: "SearchResult[] from scholar_search",
            items: { type: "object" },
          },
          notion_database_id: {
            type: "string",
            description: "Target Notion database id (UUID, with or without dashes)",
          },
          notion_token: {
            type: "string",
            description: "Optional Notion integration token (else NOTION_TOKEN env / ~/.scholar-mcp/config.json)",
          },
          include_japanese_summary: {
            type: "boolean",
            description: "Include japanese_summary field if present on the results (default false)",
          },
          dry_run: {
            type: "boolean",
            description: "If true, return the page payloads without calling Notion (default false)",
          },
        },
        required: ["results", "notion_database_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "scholar_search") {
    return handleSearch(request.params.arguments as unknown as SearchParams);
  }
  if (request.params.name === "scholar_export_to_notion") {
    return handleExportToNotion(request.params.arguments as unknown as {
      results: SearchResult[];
      notion_database_id: string;
      notion_token?: string;
      include_japanese_summary?: boolean;
      dry_run?: boolean;
    });
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function handleSearch(args: SearchParams) {
  const sources: Source[] = (args.sources ?? ["pubmed", "arxiv", "semantic_scholar"]) as Source[];
  const max_results = Math.min(args.max_results ?? 10, 50);
  const params: SearchParams = {
    query: args.query,
    max_results,
    date_from: args.date_from,
    date_to: args.date_to,
  };

  const cacheKey = buildCacheKey({
    tool: "scholar_search",
    query: args.query,
    sources,
    date_from: args.date_from,
    date_to: args.date_to,
    max_results,
  });

  const cached = searchCache.get(cacheKey);
  if (cached) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...cached, cache_hit: true, cache_hit_rate: searchCache.hitRate() },
            null,
            2,
          ),
        },
      ],
    };
  }

  const searchers: Record<Source, () => Promise<SearchResult[]>> = {
    pubmed: () => pubmed.search(params),
    arxiv: () => arxiv.search(params),
    semantic_scholar: () => semantic.search(params),
  };

  const promises = sources.map(async (s) => {
    try {
      return await searchers[s]();
    } catch (e) {
      console.error(`[scholar_search] ${s} failed:`, (e as Error).message);
      return [];
    }
  });
  const resultsArrays = await Promise.all(promises);
  const allResults = resultsArrays.flat();

  const payload: CachedPayload = {
    query: args.query,
    sources_queried: sources,
    total_results: allResults.length,
    results: allResults,
  };
  searchCache.set(cacheKey, payload);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { ...payload, cache_hit: false, cache_hit_rate: searchCache.hitRate() },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleExportToNotion(args: {
  results: SearchResult[];
  notion_database_id: string;
  notion_token?: string;
  include_japanese_summary?: boolean;
  dry_run?: boolean;
}) {
  const out = await exportResultsToNotion({
    results: args.results,
    notion_database_id: args.notion_database_id,
    notion_token: args.notion_token,
    include_japanese_summary: args.include_japanese_summary,
    dry_run: args.dry_run,
  });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(out, null, 2),
      },
    ],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[scholar-mcp] v0.3.1 running on stdio");
