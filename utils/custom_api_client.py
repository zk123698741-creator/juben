"""Desktop text generation through a user-selected OpenAI-compatible API."""
import os

from openai import AsyncOpenAI

from utils.llm_client import BaseLLMClient


class CustomAPIClient(BaseLLMClient):
    def __init__(self, **kwargs):
        model = os.getenv("CUSTOM_API_MODEL", "").strip()
        base_url = os.getenv("CUSTOM_API_BASE_URL", "").strip().rstrip("/")
        if not model or not base_url:
            raise ValueError("请在 文件 → 连接设置 中填写自定义 API 基础地址和模型名称")
        super().__init__(provider="custom", model=model,
                         api_key=os.getenv("CUSTOM_API_KEY") or "local",
                         base_url=base_url, **kwargs)
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url,
                                  timeout=self.timeout, max_retries=self.max_retries)

    def _request(self, messages, kwargs):
        # Model IDs in old sessions/agents must not replace the selected model.
        return dict(model=self.model, messages=messages,
                    temperature=kwargs.get("temperature", self.temperature),
                    max_tokens=kwargs.get("max_tokens", self.max_tokens),
                    timeout=kwargs.get("timeout", self.timeout))

    async def chat(self, messages, **kwargs):
        response = await self.client.chat.completions.create(**self._request(messages, kwargs))
        return response.choices[0].message.content or ""

    async def stream_chat(self, messages, **kwargs):
        response = await self.client.chat.completions.create(
            **self._request(messages, kwargs), stream=True)
        try:
            async for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        finally:
            await response.response.aclose()

    async def chat_with_tools(self, messages, tools=None, **kwargs):
        kwargs["model"] = self.model
        # Provider-specific extensions are not part of Chat Completions.
        for key in ("extra_body", "thinking_enabled", "prompt_cache_key", "prompt_cache_retention"):
            kwargs.pop(key, None)
        return await super().chat_with_tools(messages, tools=tools, **kwargs)
