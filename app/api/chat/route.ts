import { NextResponse } from "next/server";
import { validateApiMutationRequest } from "../../lib/api-security";
import { getProvider, getProviderAuthHeader } from "../../lib/providers";
import { CompletionMessage } from "../../lib/types";

type ChatRequest = {
  providerId: string;
  model: string;
  messages: CompletionMessage[];
};

type ProviderError = {
  error?: {
    message?: string;
  };
};

type StreamEvent = {
  event: string;
  data: string[];
};

export async function POST(request: Request) {
  const guard = validateApiMutationRequest(request, { requireJson: true });
  if (guard) {
    return guard;
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const provider = getProvider(body.providerId);
  if (!provider) {
    return NextResponse.json({ error: "Unknown providerId." }, { status: 400 });
  }

  let authHeader: Record<string, string>;
  try {
    authHeader = getProviderAuthHeader(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing provider API key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const response = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        stream: true,
      }),
      signal: request.signal,
    });

    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as ProviderError;
      return NextResponse.json(
        { error: data.error?.message || `Model provider returned HTTP ${response.status}.` },
        { status: response.status },
      );
    }

    return new Response(streamProviderDeltas(response.body), {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request aborted." }, { status: 499 });
    }
    const message = error instanceof Error ? error.message : "Unknown network error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function validateBody(body: ChatRequest) {
  if (!body || typeof body !== "object") {
    return "Request body is required.";
  }
  if (!body.providerId || typeof body.providerId !== "string") {
    return "Field providerId is required.";
  }
  if (!body.model || typeof body.model !== "string") {
    return "Field model is required.";
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return "Field messages must be a non-empty array.";
  }
  const invalid = body.messages.some(
    (message) =>
      !message ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string",
  );
  if (invalid) {
    return "Messages must include role and content.";
  }
  return null;
}

function streamProviderDeltas(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";

          for (const rawEvent of events) {
            const payload = parseSseEvent(rawEvent);
            if (payload.data.length === 0) {
              continue;
            }
            const data = payload.data.join("\n").trim();
            if (!data || data === "[DONE]") {
              continue;
            }
            if (payload.event === "error") {
              forwardStreamError(controller, encoder, readError(data) || "Provider stream failed.");
              continue;
            }
            const error = readError(data);
            if (error) {
              forwardStreamError(controller, encoder, error);
              continue;
            }
            const delta = readDelta(data);
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Streaming failed.";
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function parseSseEvent(rawEvent: string): StreamEvent {
  const event: StreamEvent = { event: "message", data: [] };
  for (const line of rawEvent.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event.event = line.slice(6).trim() || "message";
    }
    if (line.startsWith("data:")) {
      event.data.push(line.slice(5).trim());
    }
  }
  return event;
}

function forwardStreamError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  error: string,
) {
  controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error })}\n\n`));
}

function readDelta(payload: string) {
  try {
    const data = JSON.parse(payload) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

function readError(payload: string) {
  try {
    const data = JSON.parse(payload) as {
      error?: string | { message?: string };
    };
    if (typeof data.error === "string") {
      return data.error;
    }
    return data.error?.message ?? "";
  } catch {
    return "";
  }
}
