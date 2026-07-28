import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The skill files are the actual system prompts, not just documentation -
// editing .claude/skills/*/SKILL.md changes real extraction behavior. Only
// the body (after the YAML frontmatter) is sent to the model.
function readSkillPrompt(skillDir: string): string {
  const filePath = path.join(process.cwd(), ".claude", "skills", skillDir, "SKILL.md");
  const content = fs.readFileSync(filePath, "utf-8");
  return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

const MODEL = "claude-sonnet-5";

export type EmailInput = { subject: string; from: string; text: string };

export type OrderConfirmationExtraction = {
  is_order_confirmation: boolean;
  order_number: string | null;
  order_date: string | null;
  total_amount: number | null;
  expected_delivery_date: string | null;
};

export type ShippingUpdateExtraction = {
  is_shipping_update: boolean;
  order_number: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status:
    | "shipped"
    | "out_for_delivery"
    | "delivered"
    | "delayed"
    | "cancelled"
    | null;
  expected_delivery_date: string | null;
};

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

export async function extractOrderConfirmation(
  email: EmailInput,
): Promise<OrderConfirmationExtraction> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: readSkillPrompt("order-email-parsing"),
    messages: [
      {
        role: "user",
        content: `Subject: ${email.subject}\nFrom: ${email.from}\n\n${email.text}`,
      },
    ],
    tools: [
      {
        name: "extract_order_confirmation",
        description: "Record the extracted order confirmation fields.",
        input_schema: {
          type: "object",
          properties: {
            is_order_confirmation: { type: "boolean" },
            order_number: { type: ["string", "null"] },
            order_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD" },
            total_amount: { type: ["number", "null"] },
            expected_delivery_date: {
              type: ["string", "null"],
              description: "ISO YYYY-MM-DD",
            },
          },
          required: [
            "is_order_confirmation",
            "order_number",
            "order_date",
            "total_amount",
            "expected_delivery_date",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_order_confirmation" },
  });

  return extractToolInput<OrderConfirmationExtraction>(
    response,
    "extract_order_confirmation",
  );
}

export async function extractShippingUpdate(
  email: EmailInput,
): Promise<ShippingUpdateExtraction> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: readSkillPrompt("shipment-update-parsing"),
    messages: [
      {
        role: "user",
        content: `Subject: ${email.subject}\nFrom: ${email.from}\n\n${email.text}`,
      },
    ],
    tools: [
      {
        name: "extract_shipping_update",
        description: "Record the extracted shipping update fields.",
        input_schema: {
          type: "object",
          properties: {
            is_shipping_update: { type: "boolean" },
            order_number: { type: ["string", "null"] },
            tracking_number: { type: ["string", "null"] },
            carrier: { type: ["string", "null"] },
            status: {
              type: ["string", "null"],
              enum: [
                "shipped",
                "out_for_delivery",
                "delivered",
                "delayed",
                "cancelled",
                null,
              ],
            },
            expected_delivery_date: {
              type: ["string", "null"],
              description: "ISO YYYY-MM-DD",
            },
          },
          required: [
            "is_shipping_update",
            "order_number",
            "tracking_number",
            "carrier",
            "status",
            "expected_delivery_date",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_shipping_update" },
  });

  return extractToolInput<ShippingUpdateExtraction>(
    response,
    "extract_shipping_update",
  );
}
