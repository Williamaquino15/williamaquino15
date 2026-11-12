// Busca empresas no Google Maps pela API oficial (Google Places API — Text Search).
import { createLead } from "./db.js";

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
  "nextPageToken",
].join(",");

export function placesConfigured() {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

async function searchPage(textQuery, pageToken) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": FIELDS,
    },
    body: JSON.stringify({ textQuery, languageCode: "pt-BR", regionCode: "BR", pageSize: 20, ...(pageToken && { pageToken }) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Google Places HTTP ${res.status}`);
  return json;
}

/**
 * Busca e salva no CRM como prospects (etapa "novo", origem "prospeccao").
 * @param {string} query  ex.: "clínica odontológica"
 * @param {string} city   ex.: "Recife"
 * @param {string[]} areas bairros para ampliar a busca (o Google devolve no máx. 60 por busca)
 */
export async function findBusinesses({ query, city, areas = [], niche }) {
  if (!placesConfigured()) throw new Error("Configure GOOGLE_PLACES_API_KEY para buscar no Google Maps.");
  const searches = areas.length ? areas.map((a) => `${query} ${a} ${city}`) : [`${query} em ${city}`];
  const result = { found: 0, added: 0, duplicates: 0, withoutPhone: 0, closed: 0 };

  for (const textQuery of searches) {
    let token;
    for (let page = 0; page < 3; page++) {
      const data = await searchPage(textQuery, token);
      for (const p of data.places || []) {
        result.found++;
        if (p.businessStatus && p.businessStatus !== "OPERATIONAL") { result.closed++; continue; }
        const phone = p.internationalPhoneNumber || p.nationalPhoneNumber;
        if (!phone) { result.withoutPhone++; continue; }
        try {
          const { created } = createLead({
            name: p.displayName?.text,
            company: p.displayName?.text,
            phone,
            niche: niche || query,
            source: "prospeccao",
            address: p.formattedAddress,
            website: p.websiteUri,
            rating: p.rating,
            reviews: p.userRatingCount,
            maps_url: p.googleMapsUri,
            place_id: p.id,
          });
          created ? result.added++ : result.duplicates++;
        } catch {
          result.withoutPhone++;
        }
      }
      token = data.nextPageToken;
      if (!token) break;
      await new Promise((r) => setTimeout(r, 1500)); // o Google pede um intervalo antes da próxima página
    }
  }
  return result;
}
