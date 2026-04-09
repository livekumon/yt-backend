export function formatPayPalSdkError(err) {
  if (!err) return "PayPal error";
  const raw = err.message;
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      const details = j?.details;
      if (Array.isArray(details) && details.length > 0) {
        const d = details[0];
        if (d?.description) return d.description;
        if (d?.issue && d?.description) return `${d.issue}: ${d.description}`;
      }
      if (typeof j?.message === "string" && j.message) return j.message;
    } catch {
      if (raw.length > 0 && raw.length < 500) return raw;
    }
  }
  if (typeof err.statusCode === "number") {
    return `PayPal request failed (HTTP ${err.statusCode}). Check credentials and PAYPAL_MODE (sandbox vs production).`;
  }
  return typeof raw === "string" && raw ? raw : "PayPal error";
}
