import type { SearchParams, SearchResult, SourceSearcher } from "../types.js";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const USER_AGENT = "scholar-mcp/0.1.0 (https://github.com/kakedashi-eyedoc/scholar-mcp)";
const FIELDS = "title,authors,abstract,year,publicationDate,externalIds,citationCount,venue,url";

export class SemanticScholarSearcher implements SourceSearcher {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const url = new URL(`${BASE_URL}/paper/search`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("limit", String(params.max_results ?? 10));
    url.searchParams.set("fields", FIELDS);
    if (params.date_from || params.date_to) {
      const from = params.date_from ?? "1900-01-01";
      const to = params.date_to ?? new Date().toISOString().substring(0, 10);
      url.searchParams.set("publicationDateOrYear", `${from}:${to}`);
    }

    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const r = await fetch(url, { headers });
    if (!r.ok) {
      if (r.status === 429) throw new Error("Semantic Scholar rate limit exceeded");
      throw new Error(`Semantic Scholar search failed: ${r.status}`);
    }
    const data = await r.json() as { data?: any[] };
    return (data.data ?? []).map((p: any) => this.parsePaper(p)).filter((r): r is SearchResult => r !== null);
  }

  private parsePaper(paper: any): SearchResult | null {
    const id = String(paper.paperId ?? "");
    if (!id) return null;

    const title = String(paper.title ?? "").trim();
    const abstract = String(paper.abstract ?? "").trim();
    const authors = (paper.authors ?? []).map((a: any) => String(a.name ?? "")).filter(Boolean);
    const published_date = String(paper.publicationDate ?? (paper.year ? `${paper.year}-01-01` : ""));
    const doi = paper.externalIds?.DOI ? String(paper.externalIds.DOI) : undefined;
    const pmid = paper.externalIds?.PubMed ? String(paper.externalIds.PubMed) : undefined;
    const arxiv_id = paper.externalIds?.ArXiv ? String(paper.externalIds.ArXiv) : undefined;
    const venue = String(paper.venue ?? "");
    const citation_count = typeof paper.citationCount === "number" ? paper.citationCount : undefined;
    const url = String(paper.url ?? `https://www.semanticscholar.org/paper/${id}`);

    return {
      source: "semantic_scholar",
      title,
      authors,
      abstract,
      doi,
      pmid,
      arxiv_id,
      semantic_scholar_id: id,
      published_date,
      venue,
      citation_count,
      url,
    };
  }
}
