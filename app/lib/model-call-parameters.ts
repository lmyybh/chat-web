import { CompletionMessage } from "./types";

type BuildChatProviderRequestInput = {
  model: string;
  messages: CompletionMessage[];
  enableThinking?: boolean;
};

type ProviderRequestBody = {
  model: string;
  messages: CompletionMessage[];
  stream: true;
  [key: string]: unknown;
};

export function buildChatProviderRequestBody(input: BuildChatProviderRequestInput): ProviderRequestBody {
  return {
    model: input.model,
    messages: input.messages,
    stream: true,
    ...buildThinkingOptions(input.enableThinking),
  };
}

function buildThinkingOptions(enableThinking: boolean | undefined): Record<string, unknown> {
  if (enableThinking === undefined) {
    return {};
  }

  return {
    enable_thinking: enableThinking,
    chat_template_kwargs: {
      enable_thinking: enableThinking,
    },
  };
}
