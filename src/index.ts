#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PubMedSearcher } from "./sources/pubmed.js";
import { ArxivSearcher } from "./sources/arxiv.js";
import { SemanticScholarSearcher } from "./sources/semantic_scholar.js";
import type { Source, SearchParams, SearchResult } from "./types.js";

const PUBMED_API_KEY = process.env.PUBMED_API_KEY;
const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

const pubmed = new PubMedSearcher(PUBMED_API_KEY);
const arxiv = new ArxivSearcher();
const semantic = new SemanticScholarSearcher(SEMANTIC_SCHOLAR_API_KEY);

const server = new Server(
  { name: "scholar-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "scholar_search",
      description:
        "Search PubMed, arXiv, and Semantic Scholar for scholarly papers. Returns title, authors, abstract, DOI, publication date, and venue. Supports date filtering and per-source filtering.",
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "scholar_search") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as unknown as SearchParams;
  const sources: Source[] = (args.sources ?? ["pubmed", "arxiv", "semantic_scholar"]) as Source[];
  const params: SearchParams = {
    query: args.query,
    max_results: Math.min(args.max_results ?? 10, 50),
    date_from: args.date_from,
    date_to: args.date_to,
  };

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

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          query: args.query,
          sources_queried: sources,
          total_results: allResults.length,
          results: allResults,
        }, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[scholar-mcp] running on stdio");
