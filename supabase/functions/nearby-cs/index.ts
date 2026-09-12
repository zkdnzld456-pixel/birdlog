/* 근처 편의점 조회 (카카오 로컬 카테고리 검색 CS2).
   카카오 REST 키를 정적 페이지에 싣지 않으려고 이 함수 뒤에 숨긴다.
   verify_jwt 를 켜서 로그인한 사람만 부를 수 있게 하고, 그 위에 Origin 검사를 겹친다.
   (verify_jwt 는 플랫폼이 처리한다 — --no-verify-jwt 없이 배포할 것) */

const KAKAO_API = "https://dapi.kakao.com/v2/local/search/category.json";
const RADIUS = 3000, SIZE = 5;

const ALLOWED_ORIGINS = new Set([
  "https://mybirdlog.netlify.app",
  "https://dev--mybirdlog.netlify.app",
]);

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.has(origin);

  if (req.method === "OPTIONS") {
    return allowed
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : new Response(null, { status: 403 });
  }
  if (!allowed) return new Response(JSON.stringify({ error: "forbidden origin" }), { status: 403 });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

  let lat: unknown, lng: unknown;
  try {
    ({ lat, lng } = await req.json());
  } catch {
    return json({ error: "bad json" }, 400, origin);
  }
  if (typeof lat !== "number" || typeof lng !== "number"
      || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: "lat/lng required" }, 400, origin);
  }

  const key = Deno.env.get("KAKAO_REST_KEY");
  if (!key) return json({ error: "server misconfigured" }, 500, origin);

  const url = `${KAKAO_API}?category_group_code=CS2`
    + `&x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}`
    + `&radius=${RADIUS}&sort=distance&size=${SIZE}`;

  let r: Response;
  try {
    r = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  } catch (e) {
    console.error("kakao fetch", e);
    return json({ error: "upstream unreachable" }, 502, origin);
  }
  if (!r.ok) {
    console.error("kakao", r.status, await r.text().catch(() => ""));
    return json({ error: "upstream " + r.status }, 502, origin);
  }

  const j = await r.json();
  const documents = (j.documents || []).slice(0, SIZE).map((d: Record<string, string>) => ({
    place_name: d.place_name,
    distance: d.distance,
    place_url: d.place_url,
    x: d.x,
    y: d.y,
  }));
  return json({ documents }, 200, origin);
});
