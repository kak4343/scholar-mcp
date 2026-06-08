export type Source = "pubmed" | "arxiv" | "semantic_scholar";

export interface SearchResult {
  source: Source;
  title: string;
  authors: string[];
  abstract: string;
  doi?: string;
  arxiv_id?: string;
  pmid?: string;
  semantic_scholar_id?: string;
  published_date: string;
  venue?: string;
  citation_count?: number;
  url: string;
}

export interface SearchParams {
  query: string;
  sources?: Source[];
  max_results?: number;
  date_from?: string;
  date_to?: string;
}

export interface SourceSearcher {
  search(params: SearchParams): Promise<SearchResult[]>;
}
