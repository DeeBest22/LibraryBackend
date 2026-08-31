// src/schemas/payment.schemas.ts
import { z } from "zod";

export const CheckoutSessionRequestSchema = z
  .object({
    amount: z.number().positive("Amount must be greater than 0").optional(),
    currency: z.string().default("usd"),
    stripe_price_id: z.string().optional(),
    quantity: z.number().int().min(1, "Quantity must be greater than 0").default(1),
    mode: z.enum(["payment", "subscription"]).default("payment"),
    ui_mode: z.enum(["hosted", "embedded"]).default("hosted"),
    return_url: z.string().optional(),
    success_url: z.string().optional(),
    cancel_url: z.string().optional(),
    metadata: z.record(z.string()).optional(),
    idempotency_key: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "subscription") {
      if (!data.stripe_price_id) {
        ctx.addIssue({ code: "custom", message: "stripe_price_id is required for subscription mode", path: ["stripe_price_id"] });
      }
      if (data.amount !== undefined) {
        ctx.addIssue({ code: "custom", message: "amount must not be provided for subscription mode", path: ["amount"] });
      }
    } else {
      if (data.amount === undefined && !data.stripe_price_id) {
        ctx.addIssue({ code: "custom", message: "Either amount or stripe_price_id must be provided for payment mode", path: ["amount"] });
      }
      if (data.amount !== undefined && data.stripe_price_id !== undefined) {
        ctx.addIssue({ code: "custom", message: "Cannot provide both amount and stripe_price_id for payment mode", path: ["amount"] });
      }
    }

    if (data.ui_mode === "embedded") {
      if (!data.return_url) {
        ctx.addIssue({ code: "custom", message: "return_url is required when ui_mode='embedded'", path: ["return_url"] });
      } else if (!data.return_url.includes("{CHECKOUT_SESSION_ID}")) {
        ctx.addIssue({ code: "custom", message: "return_url must include {CHECKOUT_SESSION_ID}", path: ["return_url"] });
      }
    } else {
      if (!data.success_url || !data.cancel_url) {
        ctx.addIssue({ code: "custom", message: "success_url and cancel_url are required when ui_mode='hosted'", path: ["success_url"] });
      } else if (!data.success_url.includes("{CHECKOUT_SESSION_ID}")) {
        ctx.addIssue({ code: "custom", message: "success_url must include {CHECKOUT_SESSION_ID}", path: ["success_url"] });
      }
    }
  });

export type CheckoutSessionRequest = z.infer<typeof CheckoutSessionRequestSchema>;

export interface CheckoutSessionResponse {
  url?: string | null;
  client_secret?: string | null;
  session_id: string;
}

export interface CheckoutStatusResponse {
  status: string;
  payment_status: string;
  amount_total: number;
  currency: string;
  metadata: Record<string, string>;
}