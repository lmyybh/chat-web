import { NextResponse } from "next/server";
import { inspect } from "node:util";
import { validateApiMutationRequest } from "../../../lib/api-security";
import { getProvider, getProviderAuthHeader } from "../../../lib/providers";

export async function POST(request: Request) {
  const guard = validateApiMutationRequest(request, { requireJson: true });
  if (guard) return guard;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body.providerId !== "string" || !body.providerId.trim() ||
      typeof body.model !== "string" || !body.model.trim()) {
    return NextResponse.json({ error: "Fields providerId and model are required." }, { status: 400 });
  }

  try {
    const provider = getProvider(body.providerId);
    if (!provider) {
      return NextResponse.json({ error: "Unknown providerId." }, { status: 400 });
    }
    const response = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: { ...getProviderAuthHeader(provider), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model,
        messages: [{ role: "user", content: "Reply with OK only." }],
        stream: false,
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
    const raw = await response.text();
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    if (!response.ok) {
      return NextResponse.json({ error: `${status}\n\n${raw}` }, { status: 502 });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: `${status}\n响应不是有效的 JSON。\n\n${raw}` }, { status: 502 });
    }
    if (data?.error || !Array.isArray(data?.choices) || !data.choices.some((choice: { message?: { content?: unknown } }) =>
      typeof choice?.message?.content === "string" && choice.message.content.trim())) {
      return NextResponse.json({ error: `${status}\n未收到有效的模型回复。\n\n${raw}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: inspect(error, { depth: null, maxStringLength: null, maxArrayLength: null }) }, { status: 502 });
  }
}
