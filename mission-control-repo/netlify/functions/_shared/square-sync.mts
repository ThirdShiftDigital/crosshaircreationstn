const SQUARE_VERSION = "2026-01-22";
const BASE = "https://connect.squareup.com/v2";

export const squareHeaders = () => {
  const token = Netlify.env.get("SQUARE_ACCESS_TOKEN") || "";
  return {
    "Square-Version": SQUARE_VERSION,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

// Parses a price string like "$225" or "$185/hr" into whole-dollar cents.
// Ignores anything after a slash (e.g. "/hr") since Square needs a flat number.
export const parsePriceToCents = (priceText: string) => {
  const match = priceText.match(/\$?([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const dollars = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(dollars)) return null;
  return Math.round(dollars * 100);
};

export const syncPriceToSquare = async (variationId: string, newPriceText: string) => {
  const cents = parsePriceToCents(newPriceText);
  if (cents === null) return { ok: false, error: `Could not parse a price from "${newPriceText}"` };

  try {
    // 1. Retrieve the full current object — Square requires the complete object on write
    const getRes = await fetch(`${BASE}/catalog/object/${variationId}`, { headers: squareHeaders() });
    const getData = await getRes.json();
    if (!getRes.ok) return { ok: false, error: `Could not find that item in Square: ${JSON.stringify(getData)}` };

    const obj = getData.object;
    if (!obj || obj.type !== "ITEM_VARIATION") {
      return { ok: false, error: "That Square ID isn't an item variation." };
    }

    // 2. Modify only the price, preserving every other field exactly as-is
    obj.item_variation_data.price_money = {
      amount: cents,
      currency: obj.item_variation_data.price_money?.currency || "USD",
    };

    // 3. Upsert the full object back with its current version
    const putRes = await fetch(`${BASE}/catalog/object`, {
      method: "POST",
      headers: squareHeaders(),
      body: JSON.stringify({
        idempotency_key: `${variationId}-${Date.now()}`,
        object: obj,
      }),
    });
    const putData = await putRes.json();
    if (!putRes.ok) return { ok: false, error: `Square rejected the update: ${JSON.stringify(putData)}` };

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err) };
  }
};
