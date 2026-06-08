#!/usr/bin/env node
/**
 * scholar-mcp v0.2 smoke test.
 *
 * Validates:
 *   1. SearchCache: first lookup is a miss, second lookup is a hit, hit rate
 *      reflects the 1-of-2 ratio.
 *   2. Cache key determinism: same inputs in different order produce the
 *      same sha256 key.
 *   3. exportResultsToNotion dry-run: builds the expected Notion property
 *      payload without touching the network.
 *
 * Run: `npm run build && node scripts/smoke_test.mjs`
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SearchCache, buildCacheKey } from "../dist/cache/index.js";
import { exportResultsToNotion } from "../dist/notion/push.js";

const tmp = mkdtempSync(join(tmpdir(), "scholar-mcp-smoke-"));
const dbPath = join(tmp, "scholar_cache.db");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  } else {
    console.error(`  ok  : ${msg}`);
  }
}

console.error("[1/3] Cache key determinism");
const k1 = buildCacheKey({
  tool: "scholar_search",
  query: "diabetic retinopathy",
  sources: ["pubmed", "arxiv", "semantic_scholar"],
  max_results: 10,
});
const k2 = buildCacheKey({
  tool: "scholar_search",
  query: "DIABETIC RETINOPATHY",
  sources: ["semantic_scholar", "arxiv", "pubmed"],
  max_results: 10,
});
assert(k1 === k2, "same inputs (different case/order) hash to same key");
assert(k1.length === 64, "sha256 produces 64-hex-char digest");

console.error("[2/3] SearchCache hit/miss");
const cache = new SearchCache({ diskPath: dbPath });
const key = buildCacheKey({
  tool: "scholar_search",
  query: "test query",
  sources: ["pubmed"],
  max_results: 5,
});
const hit0 = cache.get(key);
assert(hit0 === undefined, "first lookup is a miss");
cache.set(key, { results: [{ source: "pubmed", title: "Test Paper" }] });
const hit1 = cache.get(key);
assert(hit1 !== undefined, "second lookup is a hit");
assert(cache.hitRate() === 0.5, `hit rate is 0.5 (got ${cache.hitRate()})`);

// disk persistence: new in-memory cache, same disk path -> still hits
const cache2 = new SearchCache({ diskPath: dbPath });
const hit2 = cache2.get(key);
assert(hit2 !== undefined, "disk cache persists across SearchCache instances");
cache.close();
cache2.close();

console.error("[3/3] exportResultsToNotion dry-run schema");
const sampleResult = {
  source: "pubmed",
  title: "Sample paper on diabetic retinopathy",
  authors: ["Yamada T", "Suzuki K"],
  abstract: "Background. Methods. Results. Conclusions.",
  doi: "10.1000/example.2026.001",
  pmid: "12345678",
  published_date: "2026-01-15",
  venue: "JAMA Ophthalmology",
  citation_count: 42,
  url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
};
const dry = await exportResultsToNotion({
  results: [sampleResult],
  notion_database_id: "0a489d15-83e8-471d-ba1e-f04030473967",
  include_japanese_summary: false,
  dry_run: true,
});

assert(dry.dry_run === true, "dry_run flag echoed in output");
assert(dry.total === 1, "total = 1");
assert(dry.created === 0, "created = 0 in dry run");
assert(dry.pages.length === 1, "one page payload returned");
const p = dry.pages[0];
assert(p.status === "dry_run", "page status = dry_run");
assert(p.properties.Title !== undefined, "Title property present");
assert(p.properties.Authors !== undefined, "Authors property present");
assert(p.properties.DOI !== undefined && p.properties.DOI.url.includes("doi.org"), "DOI normalised to URL");
assert(p.properties.Source.select.name === "pubmed", "Source select = pubmed");
assert(p.properties.Published.date.start === "2026-01-15", "Published date passed through");
assert(p.properties.Venue !== undefined, "Venue rich_text present");
assert(p.properties["Citation Count"].number === 42, "Citation Count = 42");
assert(p.properties.Abstract !== undefined, "Abstract rich_text present");
assert(p.properties.Status.select.name === "To Read", "Status defaults to 'To Read'");
assert(p.properties["Japanese Summary"] === undefined, "Japanese Summary omitted when not requested");

// teardown
rmSync(tmp, { recursive: true, force: true });

if (failures === 0) {
  console.error("\nAll smoke checks passed.");
  process.exit(0);
} else {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
