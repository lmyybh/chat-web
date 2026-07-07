import { NextResponse } from "next/server";
import { createProvider, deleteProvider, getPublicProviders } from "../../lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ providers: getPublicProviders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load providers.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { id?: string; name?: string; baseURL?: string; apiKey?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = createProvider({
      id: body.id || "",
      name: body.name || "",
      baseURL: body.baseURL || "",
      apiKey: body.apiKey || null,
    });
    return NextResponse.json({ providers: getPublicProviders(), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create provider.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("id") || "";
  try {
    const result = deleteProvider(providerId);
    return NextResponse.json({ providers: getPublicProviders(), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete provider.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
