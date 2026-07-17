// Proxies Google Places API (New) so the API key never reaches the browser.
// Env vars required: GOOGLE_PLACES_API_KEY, GOOGLE_PLACE_ID

const FIELDS = 'displayName,rating,userRatingCount,googleMapsUri,reviews';

exports.handler = async (event) => {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!key || !placeId) {
    return json(500, { error: 'missing_config', message: 'GOOGLE_PLACES_API_KEY or GOOGLE_PLACE_ID not set' });
  }

  const lang = (event.queryStringParameters && event.queryStringParameters.lang) || 'pl';
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
    + `?fields=${FIELDS}&languageCode=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      return json(res.status, {
        error: 'google_error',
        message: (data.error && data.error.message) || 'Places API request failed'
      });
    }

    const payload = {
      name: data.displayName && data.displayName.text,
      rating: data.rating || null,
      total: data.userRatingCount || 0,
      mapsUri: data.googleMapsUri || null,
      reviews: (data.reviews || []).map((r) => ({
        author: (r.authorAttribution && r.authorAttribution.displayName) || 'Google User',
        photo: (r.authorAttribution && r.authorAttribution.photoUri) || null,
        profile: (r.authorAttribution && r.authorAttribution.uri) || null,
        rating: r.rating || 0,
        text: (r.originalText && r.originalText.text) || (r.text && r.text.text) || '',
        when: r.relativePublishTimeDescription || '',
        publishTime: r.publishTime || null
      }))
    };

    return json(200, payload, {
      // Browser holds it briefly; Netlify's CDN holds it 6h and serves stale for a day
      // while revalidating, so Google gets hit ~4x/day regardless of traffic.
      'Cache-Control': 'public, max-age=300',
      'Netlify-CDN-Cache-Control': 'public, max-age=21600, stale-while-revalidate=86400'
    });
  } catch (err) {
    return json(502, { error: 'fetch_failed', message: String(err && err.message) });
  }
};

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}
