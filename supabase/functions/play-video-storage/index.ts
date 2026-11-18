import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const githubToken = Deno.env.get("GITHUB_TOKEN")!;
    const owner = Deno.env.get("GITHUB_OWNER") || "Dompinator";
    const repo = Deno.env.get("GITHUB_REPO") || "Grind";
    const branch = Deno.env.get("GITHUB_BRANCH") || "play-media";
    if (!supabaseUrl || !anonKey || !serviceKey || !githubToken) {
      return json({ error: "PLAY video storage is not configured yet." }, 503);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session." }, 401);
    const user = authData.user;

    const body = await req.json();
    const action = body?.action;
    const videoId = String(body?.videoId || "");
    if (!/^[A-Za-z0-9_-]{5,100}$/.test(videoId)) {
      return json({ error: "Invalid video ID." }, 400);
    }

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const ghHeaders = {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (action === "upload") {
      const dataUrl = String(body?.dataUrl || "");
      const match = dataUrl.match(/^data:(video\/(?:webm|mp4));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json({ error: "Unsupported compressed video format." }, 400);
      const mime = match[1];
      const encoded = match[2];
      const approximateBytes = Math.floor(encoded.length * 3 / 4);
      if (approximateBytes > 3 * 1024 * 1024) {
        return json({ error: "Compressed video exceeds the 3 MB limit." }, 413);
      }
      const extension = mime === "video/mp4" ? "mp4" : "webm";
      const path = `PLAY/${user.id}/${videoId}.${extension}`;
      const response = await fetch(`${apiBase}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Add PLAY video ${videoId}`,
          branch,
          content: encoded,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return json({ error: result?.message || "GitHub could not save the video." }, response.status);
      }
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      return json({ url, path, mime });
    }

    if (action === "delete") {
      const ownerId = String(body?.ownerId || user.id);
      if (ownerId !== user.id) {
        const adminClient = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: profile } = await adminClient.from("profiles")
          .select("username").eq("id", user.id).maybeSingle();
        if (String(profile?.username || "").toLowerCase() !== "dompinator") {
          return json({ error: "Not allowed to delete this video." }, 403);
        }
      }
      if (!/^[0-9a-f-]{20,60}$/i.test(ownerId)) return json({ error: "Invalid owner ID." }, 400);

      let deleted = false;
      for (const extension of ["webm", "mp4"]) {
        const path = `PLAY/${ownerId}/${videoId}.${extension}`;
        const url = `${apiBase}/${path.split("/").map(encodeURIComponent).join("/")}`;
        const current = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
        if (current.status === 404) continue;
        const currentData = await current.json().catch(() => ({}));
        if (!current.ok || !currentData?.sha) continue;
        const removed = await fetch(url, {
          method: "DELETE",
          headers: { ...ghHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Delete PLAY video ${videoId}`,
            sha: currentData.sha,
            branch,
          }),
        });
        if (removed.ok) deleted = true;
      }
      return json({ deleted });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected upload error." }, 500);
  }
});
