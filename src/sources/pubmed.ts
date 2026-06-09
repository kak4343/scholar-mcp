import { XMLParser } from "fast-xml-parser";
import type { SearchParams, SearchResult, SourceSearcher } from "../types.js";

const BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const USER_AGENT = "scholar-mcp/0.2.1 (https://github.com/kak4343/scholar-mcp)";

export class PubMedSearcher implements SourceSearcher {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const pmids = await this.esearch(params);
    if (pmids.length === 0) return [];
    return this.efetch(pmids);
  }

  private async esearch(params: SearchParams): Promise<string[]> {
    const url = new URL(`${BASE_URL}/esearch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("term", this.buildTerm(params));
    url.searchParams.set("retmax", String(params.max_results ?? 10));
    url.searchParams.set("retmode", "json");
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);

    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`PubMed esearch failed: ${r.status}`);
    const data = await r.json() as { esearchresult?: { idlist?: string[] } };
    return data.esearchresult?.idlist ?? [];
  }

  private buildTerm(params: SearchParams): string {
    let term = params.query;
    if (params.date_from || params.date_to) {
      const from = (params.date_from ?? "1900/01/01").replace(/-/g, "/");
      const to = (params.date_to ?? "3000/01/01").replace(/-/g, "/");
      term += ` AND (${from}[PDAT] : ${to}[PDAT])`;
    }
    return term;
  }

  private async efetch(pmids: string[]): Promise<SearchResult[]> {
    const url = new URL(`${BASE_URL}/efetch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("id", pmids.join(","));
    url.searchParams.set("retmode", "xml");
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);

    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`PubMed efetch failed: ${r.status}`);
    const xml = await r.text();

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const parsed = parser.parse(xml);
    const articles = parsed.PubmedArticleSet?.PubmedArticle;
    if (!articles) return [];
    const articleArray = Array.isArray(articles) ? articles : [articles];

    return articleArray.map((a: any) => this.parseArticle(a)).filter((r): r is SearchResult => r !== null);
  }

  private parseArticle(article: any): SearchResult | null {
    const medlineCitation = article.MedlineCitation;
    if (!medlineCitation) return null;

    const pmid = String(medlineCitation.PMID?.["#text"] ?? medlineCitation.PMID ?? "");
    const articleData = medlineCitation.Article;
    if (!articleData) return null;

    const title = String(articleData.ArticleTitle?.["#text"] ?? articleData.ArticleTitle ?? "").trim();

    const abstractText = articleData.Abstract?.AbstractText;
    const abstract = this.flattenAbstract(abstractText);

    const authorList = articleData.AuthorList?.Author;
    const authors = this.parseAuthors(authorList);

    const journal = articleData.Journal?.Title ?? articleData.Journal?.ISOAbbreviation ?? "";
    const pubDate = articleData.Journal?.JournalIssue?.PubDate;
    const published_date = this.parseDate(pubDate);

    const doi = this.extractDoi(article);

    return {
      source: "pubmed",
      title,
      authors,
      abstract,
      pmid,
      doi,
      published_date,
      venue: journal,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  }

  private flattenAbstract(abstractText: any): string {
    if (!abstractText) return "";
    if (typeof abstractText === "string") return abstractText;
    if (Array.isArray(abstractText)) {
      return abstractText.map((t: any) => this.flattenAbstract(t)).join(" ");
    }
    if (abstractText["#text"]) return String(abstractText["#text"]);
    return "";
  }

  private parseAuthors(authorList: any): string[] {
    if (!authorList) return [];
    const arr = Array.isArray(authorList) ? authorList : [authorList];
    return arr.map((a: any) => {
      const last = a.LastName ?? "";
      const initials = a.Initials ?? a.ForeName ?? "";
      return `${last}${initials ? ` ${initials}` : ""}`.trim();
    }).filter(Boolean);
  }

  private parseDate(pubDate: any): string {
    if (!pubDate) return "";
    const year = pubDate.Year ?? "";
    const month = pubDate.Month ?? "01";
    const day = pubDate.Day ?? "01";
    const monthNum = isNaN(Number(month)) ? this.monthNameToNum(month) : String(month).padStart(2, "0");
    return year ? `${year}-${monthNum}-${String(day).padStart(2, "0")}` : "";
  }

  private monthNameToNum(month: string): string {
    const map: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    return map[month] ?? "01";
  }

  private extractDoi(article: any): string | undefined {
    const ids = article.PubmedData?.ArticleIdList?.ArticleId;
    if (!ids) return undefined;
    const arr = Array.isArray(ids) ? ids : [ids];
    const doiEntry = arr.find((i: any) => i["@_IdType"] === "doi");
    return doiEntry ? String(doiEntry["#text"] ?? doiEntry) : undefined;
  }
}
