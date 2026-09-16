import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The skill file is the actual system prompt, not just documentation -
// editing .claude/skills/order-pdf-invoice-parsing/SKILL.md changes real
// extraction behavior. Only the body (after the YAML frontmatter) is sent
// to the model.
function readSkillPrompt(skillDir: string): string {
  const filePath = path.join(process.cwd(), ".claude", "skills", skillDir, "SKILL.md");
  const content = fs.readFileSync(filePath, "utf-8");
  return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

const MODEL = "claude-sonnet-5";

function extractToolInput<T>(response: Anthropic.Message, toolName: string): T {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === toolName,
  );
  if (!toolUse) {
    throw new Error(`Model did not return a ${toolName} tool_use block`);
  }
  return toolUse.input as T;
}

export type PdfInvoiceShipmentItem = {
  name: string;
  quantity: number;
  unit_price: number | null;
};

export type PdfInvoiceShipment = {
  shipped_date: string | null;
  items: PdfInvoiceShipmentItem[];
};

export type PdfInvoiceExtraction = {
  is_amazon_invoice: boolean;
  amazon_order_number: string | null;
  po_number: string | null;
  order_placed_date: string | null;
  order_total: number | null;
  shipments: PdfInvoiceShipment[];
};

// A per-order Amazon "Final Details" PDF, passed as a base64 document
// content block rather than plain text. Used by /orders/reconcile-invoice
// - the one optional AI-extraction path kept after the email/CSV intake
// pipelines were removed (product-owner-directed simplification: orders
// only ever come from cleaner supply requests or manual entry now; PDF
// reconciliation remains available purely as an optional way to get more
// accurate per-item pricing than typing it by hand).
export async function extractPdfInvoice(
  pdfBase64: string,
): Promise<PdfInvoiceExtraction> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: readSkillPrompt("order-pdf-invoice-parsing"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
        ],
      },
    ],
    tools: [
      {
        name: "extract_pdf_invoice",
        description: "Record the extracted Amazon invoice fields.",
        input_schema: {
          type: "object",
          properties: {
            is_amazon_invoice: { type: "boolean" },
            amazon_order_number: { type: ["string", "null"] },
            po_number: { type: ["string", "null"] },
            order_placed_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD" },
            order_total: { type: ["number", "null"] },
            shipments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  shipped_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        quantity: { type: "number" },
                        unit_price: { type: ["number", "null"] },
                      },
                      required: ["name", "quantity", "unit_price"],
                    },
                  },
                },
                required: ["shipped_date", "items"],
              },
            },
          },
          required: [
            "is_amazon_invoice",
            "amazon_order_number",
            "po_number",
            "order_placed_date",
            "order_total",
            "shipments",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_pdf_invoice" },
  });

  return extractToolInput<PdfInvoiceExtraction>(response, "extract_pdf_invoice");
}
