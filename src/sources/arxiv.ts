import { XMLParser } from "fast-xml-parser";
import type { SearchParams, SearchResult, SourceSearcher } from "../types.js";

const BASE_URL = "http://export.arxiv.org/api/query";
const USER_AGENT = "scholar-mcp/0.1.0 (https://github.com/kakedashi-eyedoc/scholar-mcp)";

export class ArxivSearcher implements SourceSearcher {
  async search(params: SearchParams): Promise<SearchResult[]> {
    const url = new URL(BASE_URL);
    url.searchParams.set("search_query", `all:${params.query}`);
    url.searchParams.set("max_results", String(params.max_results ?? 10));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");

    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`arXiv search failed: ${r.status}`);
    const xml = await r.text();

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const parsed = parser.parse(xml);
    const entries = parsed.feed?.entry;
    if (!entries) return [];
    const entryArray = Array.isArray(entries) ? entries : [entries];

    return entryArray.map((e: any) => this.parseEntry(e)).filter((r): r is SearchResult => {
      if (r === null) return false;
      if (params.date_from && r.published_date < params.date_from) return false;
      if (params.date_to && r.published_date > params.date_to) return false;
      return true;
    });
  }

  private parseEntry(entry: any): SearchResult | null {
    const id = String(entry.id ?? "");
    if (!id) return null;
    const arxiv_id = id.split("/abs/")[1]?.replace(/v\d+$/, "") ?? id;

    const title = String(entry.title ?? "").replace(/\s+/g, " ").trim();
    const abstract = String(entry.summary ?? "").replace(/\s+/g, " ").trim();
    const published_date = String(entry.published ?? "").substring(0, 10);

    const authorRaw = entry.author;
    const authorArray = Array.isArray(authorRaw) ? authorRaw : (authorRaw ? [authorRaw] : []);
    const authors = authorArray.map((a: any) => String(a.name ?? "")).filter(Boolean);

    const categoryRaw = entry.category;
    const categoryArray = Array.isArray(categoryRaw) ? categoryRaw : (categoryRaw ? [categoryRaw] : []);
    const venue = categoryArray.map((c: any) => c["@_term"]).filter(Boolean).join(", ");

    return {
      source: "arxiv",
      title,
      authors,
      abstract,
      arxiv_id,
      published_date,
      venue: venue || "arXiv preprint",
      url: id,
    };
  }
}
