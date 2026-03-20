import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStatus, parseDiffRowHtml } from "./revision-history.parsers";

test("normalizeStatus matches known statuses case-insensitively", () => {
  assert.equal(normalizeStatus("in progress"), "In Progress");
  assert.equal(normalizeStatus("Completed"), "Completed");
  assert.equal(normalizeStatus("Unknown X"), "Unknown X");
});

test("parseDiffRowHtml extracts Status change (old -> new) from pill diff", () => {
  const html = `
    <div class="historicalCellContainer">
      <div class="micro strong caps" columnId="fldStatus">Status</div>
      <div class="historicalCellValueContainer" columntypeifunchanged="select">
        <div class="historicalCellValue diff" data-columntype="select">
          <div>
            <span class="colors-background-success" title="On Hold">On Hold</span>
            <span class="strikethrough colors-background-negative" title="In Progress">In Progress</span>
          </div>
        </div>
      </div>
    </div>
  `;
  const parsed = parseDiffRowHtml(html);
  assert.deepEqual(parsed, [{ columnLabel: "Status", oldValue: "In Progress", newValue: "On Hold" }]);
});

test("parseDiffRowHtml extracts Assigned To change (old -> new) from textDiff spans", () => {
  const html = `
    <div class="historicalCellContainer">
      <div class="micro strong caps" columnId="fldName">Name</div>
      <div class="historicalCellValueContainer" columntypeifunchanged="text">
        <div class="historicalCellValue diff" data-columntype="text">
          <div class="textDiff overflow-hidden">
            <span class="pre-wrap colors-background-negative colors-foreground-accent-negative strikethrough">VK</span>
            <span class="pre-wrap colors-background-success">VK1</span>
          </div>
        </div>
      </div>
    </div>
  `;
  const parsed = parseDiffRowHtml(html);
  assert.deepEqual(parsed, [{ columnLabel: "Name", oldValue: "VK", newValue: "VK1" }]);
});

