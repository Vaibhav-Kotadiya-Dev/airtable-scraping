import * as cheerio from "cheerio";

export const KNOWN_STATUSES = ["Not Started", "In Progress", "On Hold", "Completed", "Planning"] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

export type ParsedChange = {
  columnLabel: "Status" | "Assigned To" | "Name";
  oldValue: string;
  newValue: string;
};

function cleanText(value: string | undefined | null): string {
  return (value ?? "").toString().replace(/\s+/g, " ").trim();
}

export function normalizeStatus(value: string): string {
  const v = value.trim();
  const match = KNOWN_STATUSES.find((s) => s.toLowerCase() === v.toLowerCase());
  return match ?? v;
}

function parseTextDiffOldNew($container: cheerio.Cheerio<any>): { oldValue: string; newValue: string } | null {
  const textDiff = $container.find(`.textDiff`).first();
  if (!textDiff.length) return null;
  const oldVal = cleanText(textDiff.find(`.strikethrough, .colors-background-negative`).first().text());
  const newVal = cleanText(textDiff.find(`.colors-background-success`).first().text());
  if (!oldVal && !newVal) return null;
  return { oldValue: oldVal, newValue: newVal };
}

function parsePillOldNew($container: cheerio.Cheerio<any>): { oldValue: string; newValue: string } | null {
  // Airtable renders select/foreignKey diffs as two "pills": new (green) + old (red/strikethrough).
  const newVals: string[] = [];
  const oldVals: string[] = [];

  $container.find(`span[title], div[title]`).each((_i, el) => {
    const $el = cheerio.load(el).root().children().first();
    const title = $el.attr("title");
    const text = cleanText(title ?? $el.text());
    if (!text) return;

    const isOld =
      $el.closest(`.strikethrough, .colors-background-negative, [class*="redLight"], [class*="red-red"]`).length > 0 ||
      $el.attr("style")?.toLowerCase().includes("line-through") === true;

    if (isOld) oldVals.push(text);
    else newVals.push(text);
  });

  const newValue = newVals[0] ?? "";
  const oldValue = oldVals[0] ?? "";
  if (!newValue && !oldValue) return null;
  if (newValue === oldValue) return null;
  return { oldValue, newValue };
}

export function parseDiffRowHtml(diffRowHtml: string): ParsedChange[] {
  const out: ParsedChange[] = [];
  const $ = cheerio.load(diffRowHtml);

  $(`.historicalCellContainer`).each((_i, containerEl) => {
    const $container = $(containerEl);
    const label = cleanText($container.find(`.micro.strong`).first().text());
    if (!label) return;

    const $cellValue = $container.find(`.historicalCellValue`).first();
    if (!$cellValue.length) return;

    if (label === "Status" || label === "Assigned To") {
      const pill = parsePillOldNew($cellValue);
      if (!pill) return;
      out.push({ columnLabel: label, oldValue: pill.oldValue, newValue: pill.newValue });
      return;
    }

    if (label === "Name") {
      const diff = parseTextDiffOldNew($cellValue);
      if (!diff) return;
      // If one side is missing, Airtable sometimes only renders one span.
      const oldValue = diff.oldValue || diff.newValue;
      const newValue = diff.newValue || diff.oldValue;
      if (oldValue === newValue) return;
      out.push({ columnLabel: "Name", oldValue, newValue });
      return;
    }
  });

  return out;
}

