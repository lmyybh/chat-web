import { describe, expect, it } from "vitest";
import { buildChatProviderRequestBody } from "./model-call-parameters";

const messages = [{ role: "user" as const, content: "hello" }];

describe("buildChatProviderRequestBody", () => {
  it("forwards the unified thinking enabled parameters", () => {
    expect(
      buildChatProviderRequestBody({
        model: "DeepSeek/deepseek-v4-pro",
        messages,
        enableThinking: true,
      }),
    ).toEqual({
      model: "DeepSeek/deepseek-v4-pro",
      messages,
      stream: true,
      enable_thinking: true,
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it("forwards the unified thinking disabled parameters", () => {
    expect(
      buildChatProviderRequestBody({
        model: "qwen3",
        messages,
        enableThinking: false,
      }),
    ).toEqual({
      model: "qwen3",
      messages,
      stream: true,
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("does not add thinking parameters when no thinking preference is provided", () => {
    expect(
      buildChatProviderRequestBody({
        model: "qwen3",
        messages,
      }),
    ).toEqual({
      model: "qwen3",
      messages,
      stream: true,
    });
  });
});
