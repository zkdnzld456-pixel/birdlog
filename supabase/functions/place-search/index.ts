/* 지명 검색 (카카오 로컬 키워드 검색) — 기록·수정 화면의 "위치 지정" 시트에서 쓴다.
   nearby-cs 와 같은 구조: 카카오 REST 키를 정적 페이지에 싣지 않으려고 이 함수 뒤에 숨기고,
   verify_jwt + Origin 검사 + getUser() 로 "진짜 로그인한 사람" 만 통과시킨다.
   (verify_jwt 는 플랫폼이 처리한다 — --no-verify-jwt 없이 배포할 것)
   검색어는 로그에 남기지 않는다. */

import { createClient } from "jsr:@supabase/supabase-js@2";

const KAKAO_API = "https://dapi.kakao.com/v2/local/search/keyword.json";
const SIZE = 5, MAX_Q = 60;

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

async function isSignedIn(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;

  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    console.error("auth: SUPABASE_URL/ANON_KEY 없음");
    return false;
  }
  try {
    const { data, error } = await createClient(url, anon).auth.getUser(token);
    if (error) return false;
    return !!(data && data.user);
  } catch (e) {
    console.error("auth: getUser 실패", e instanceof Error ? e.message : e);
    return false;
  }
}

function finiteCoord(v: unknown, max: number) {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
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

  if (!(await isSignedIn(req))) return json({ error: "unauthorized" }, 401, origin);

  let q: unknown, lat: unknown, lng: unknown;
  try {
    ({ q, lat, lng } = await req.json());
  } catch {
    return json({ error: "bad json" }, 400, origin);
  }
  if (typeof q !== "string" || !q.trim()) return json({ error: "q required" }, 400, origin);
  const query = q.trim().slice(0, MAX_Q);

  const key = Deno.env.get("KAKAO_REST_KEY");
  if (!key) return json({ error: "server misconfigured" }, 500, origin);

  // 지도 중심을 같이 보내면 가까운 곳이 먼저 온다 (없으면 전국 검색)
  let url = `${KAKAO_API}?query=${encodeURIComponent(query)}&size=${SIZE}`;
  if (finiteCoord(lat, 90) && finiteCoord(lng, 180)) {
    url += `&x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}&sort=accuracy`;
  }

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
    address_name: d.address_name,
    road_address_name: d.road_address_name,
    x: d.x,
    y: d.y,
  }));
  return json({ documents }, 200, origin);
});
