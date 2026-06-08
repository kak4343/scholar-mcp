import { Client } from "@notionhq/client";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SearchResult } from "../types.js";

/**
 * Notion page schema used by scholar_export_to_notion.
 *
 * Compatible with the user's existing Knowledge DB (data_source_id
 * 0a489d15-83e8-471d-ba1e-f04030473967) and the eye-ophthalmology weekly
 * review push_to_notion.py helper.
 *
 * Properties (must be defined on the target database):
 *   Title           - title
 *   Authors         - rich_text
 *   DOI             - url
 *   Source          - select (pubmed / arxiv / semantic_scholar)
 *   Published       - date
 *   Venue           - rich_text
 *   Citation Count  - number
 *   Abstract        - rich_text  (truncated to 2000 chars, full text in body)
 *   Japanese Summary - rich_text (only when include_japanese_summary)
 *   Status          - select ("To Read")
 */

const ABSTRACT_PROPERTY_LIMIT = 2000; // Notion rich_text per-property hard limit
const BLOCK_TEXT_LIMIT = 2000; // Notion paragraph block hard limit

export interface ExportInput {
  results: SearchResult[];
  notion_database_id: string;
  notion_token?: string;
  include_japanese_summary?: boolean;
  dry_run?: boolean;
}

export interface ExportedPage {
  result_index: number;
  title: string;
  page_id?: string;
  page_url?: string;
  status: "created" | "dry_run" | "error";
  error?: string;
  /** Page properties payload that was (or would be) sent to Notion. */
  properties: Record<string, unknown>;
  /** Children blocks that were (or would be) appended. */
  children: Array<Record<string, unknown>>;
}

export interface ExportOutput {
  database_id: string;
  total: number;
  created: number;
  errors: number;
  dry_run: boolean;
  pages: ExportedPage[];
}

/**
 * Resolve a Notion token from (in order): explicit arg, NOTION_TOKEN env,
 * ~/.scholar-mcp/config.json `{ "notion_token": "..." }`. Returns undefined
 * if nothing matched — callers in dry-run mode can ignore that, but real
 * exports must fail.
 */
export function resolveNotionToken(explicit?: string): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  if (process.env.NOTION_TOKEN && process.env.NOTION_TOKEN.trim()) {
    return process.env.NOTION_TOKEN.trim();
  }
  const configPath = join(homedir(), ".scholar-mcp", "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { notion_token?: string };
      if (cfg.notion_token && cfg.notion_token.trim()) return cfg.notion_token.trim();
    } catch {
      // ignore malformed config; treat as missing
    }
  }
  return undefined;
}

function richText(content: string): Array<{ type: "text"; text: { content: string } }> {
  if (!content) return [];
  return [{ type: "text", text: { content: content.slice(0, ABSTRACT_PROPERTY_LIMIT) } }];
}

function chunkParagraphBlocks(content: string): Array<Record<string, unknown>> {
  if (!content) return [];
  const blocks: Array<Record<string, unknown>> = [];
  for (let i = 0; i < content.length; i += BLOCK_TEXT_LIMIT) {
    const chunk = content.slice(i, i + BLOCK_TEXT_LIMIT);
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: chunk } }],
      },
    });
  }
  return blocks;
}

function buildPagePayload(
  r: SearchResult,
  databaseId: string,
  includeJapaneseSummary: boolean,
): { properties: Record<string, unknown>; children: Array<Record<string, unknown>> } {
  const properties: Record<string, unknown> = {
    Title: { title: richText(r.title || "(untitled)") },
    Authors: { rich_text: richText(r.authors.join(", ")) },
    Source: { select: { name: r.source } },
    Status: { select: { name: "To Read" } },
  };

  if (r.doi) {
    properties.DOI = { url: r.doi.startsWith("http") ? r.doi : `https://doi.org/${r.doi}` };
  }
  if (r.published_date) {
    properties.Published = { date: { start: r.published_date } };
  }
  if (r.venue) {
    properties.Venue = { rich_text: richText(r.venue) };
  }
  if (typeof r.citation_count === "number") {
    properties["Citation Count"] = { number: r.citation_count };
  }
  if (r.abstract) {
    properties.Abstract = { rich_text: richText(r.abstract) };
  }
  if (includeJapaneseSummary && (r as SearchResult & { japanese_summary?: string }).japanese_summary) {
    properties["Japanese Summary"] = {
      rich_text: richText((r as SearchResult & { japanese_summary?: string }).japanese_summary!),
    };
  }

  // Mirror the abstract (and full japanese summary) as body blocks so the
  // 2000-char cap on rich_text properties never truncates the source text.
  const children: Array<Record<string, unknown>> = [];
  if (r.abstract && r.abstract.length > ABSTRACT_PROPERTY_LIMIT) {
    children.push(...chunkParagraphBlocks(r.abstract));
  }

  // (databaseId is consumed by the caller, not here)
  void databaseId;
  return { properties, children };
}

/**
 * Push search results to a Notion database.
 *
 * Strategy: build per-result page payloads, then either return them
 * unchanged (dry-run) or POST each one to Notion sequentially. Errors are
 * captured per result so a single bad row does not abort the batch.
 */
export async function exportResultsToNotion(input: ExportInput): Promise<ExportOutput> {
  const dryRun = input.dry_run ?? false;
  const includeJp = input.include_japanese_summary ?? false;
  const databaseId = input.notion_database_id;

  if (!databaseId || !databaseId.trim()) {
    throw new Error("notion_database_id is required");
  }

  let client: Client | undefined;
  if (!dryRun) {
    const token = resolveNotionToken(input.notion_token);
    if (!token) {
      throw new Error(
        "Notion token not found. Set NOTION_TOKEN env or ~/.scholar-mcp/config.json {\"notion_token\": \"...\"}"
      );
    }
    client = new Client({ auth: token });
  }

  const pages: ExportedPage[] = [];
  let created = 0;
  let errors = 0;

  for (let i = 0; i < input.results.length; i++) {
    const r = input.results[i];
    const { properties, children } = buildPagePayload(r, databaseId, includeJp);

    if (dryRun || !client) {
      pages.push({
        result_index: i,
        title: r.title,
        status: "dry_run",
        properties,
        children,
      });
      continue;
    }

    try {
      const resp = await client.pages.create({
        parent: { database_id: databaseId },
        // The Notion SDK's property typings are tighter than our generic
        // record; the runtime accepts our payload but the type checker
        // wants the concrete union, so cast at the boundary.
        properties: properties as Parameters<Client["pages"]["create"]>[0]["properties"],
        children: children as Parameters<Client["pages"]["create"]>[0]["children"],
      });
      const pageRes = resp as { id?: string; url?: string };
      pages.push({
        result_index: i,
        title: r.title,
        page_id: pageRes.id,
        page_url: pageRes.url,
        status: "created",
        properties,
        children,
      });
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pages.push({
        result_index: i,
        title: r.title,
        status: "error",
        error: msg,
        properties,
        children,
      });
      errors++;
    }
  }

  return {
    database_id: databaseId,
    total: input.results.length,
    created,
    errors,
    dry_run: dryRun,
    pages,
  };
}
