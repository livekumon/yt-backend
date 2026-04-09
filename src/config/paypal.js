import { createRequire } from "module";

const require = createRequire(import.meta.url);
const checkoutNodeJssdk = require("@paypal/checkout-server-sdk");

export const paypal = checkoutNodeJssdk;

function environment() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const mode = process.env.PAYPAL_MODE || "sandbox";

  if (!clientId || !clientSecret) {
    throw new Error(
      "PayPal credentials not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET"
    );
  }

  if (mode === "production") {
    return new checkoutNodeJssdk.core.LiveEnvironment(clientId, clientSecret);
  }
  return new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

export function getPayPalClient() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}
