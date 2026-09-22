import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional
import httpx
from .types import (
    ChatMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    ToolCall,
    ToolDefinition,
    StreamEvent
)
from src.security.guard import SecurityGuard
from src.security.redaction import SensitiveDataRedactor

logger = logging.getLogger(__name__)

_GLOBAL_HTTP_CLIENT: Optional[httpx.AsyncClient] = None

def get_shared_http_client(timeout: float = 60.0) -> httpx.AsyncClient:
    global _GLOBAL_HTTP_CLIENT
    if _GLOBAL_HTTP_CLIENT is None or _GLOBAL_HTTP_CLIENT.is_closed:
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=50, keepalive_expiry=30.0)
        _GLOBAL_HTTP_CLIENT = httpx.AsyncClient(
            timeout=timeout,
            limits=limits,
            http2=True
        )
    return _GLOBAL_HTTP_CLIENT

class LLMClient:
    """
    Unified Async LLM Client supporting OpenAI-compatible endpoints (NVIDIA NIM, Groq, Gemini, Local).
    Implements persistent HTTP/2 connection pooling, streaming SSE, and robust retry policies.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 60.0,
        max_retries: int = 2
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or "no-key"
        self.timeout = timeout
        self.max_retries = max_retries

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    @staticmethod
    def _temperature_adjustment_from_error(err_text: str) -> Optional[Dict[str, Any]]:
        lower = err_text.lower()
        if "temperature" not in lower:
            return None

        range_match = re.search(
            r"supported\s+values\s+are\s+between\s+([-+]?\d+(?:\.\d+)?)\s+and\s+([-+]?\d+(?:\.\d+)?)",
            lower
        )
        if range_match:
            min_value = float(range_match.group(1))
            max_value = float(range_match.group(2))
            if min_value == max_value:
                return {"action": "set", "value": min_value}
            return {"action": "set", "value": max(min_value, min(max_value, 0.2))}

        value_match = re.search(r"(?:only|supported)\s+(?:value|values).*?([-+]?\d+(?:\.\d+)?)", lower)
        if value_match:
            return {"action": "set", "value": float(value_match.group(1))}

        if "not supported" in lower or "unsupported_parameter" in lower:
            return {"action": "omit"}

        return None

    async def stream_chat(
        self,
        request: ChatCompletionRequest
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Streams completion chunks via Server-Sent Events (SSE).
        Yields StreamEvent objects for reasoning, content, parsed tool calls, and token usage.
        """
        url = f"{self.base_url}/chat/completions"

        # Redact any sensitive information from messages on egress before cloud transmission
        sanitized_messages = []
        for m in request.messages:
            msg_dict = m.to_api_dict()
            if isinstance(msg_dict.get("content"), str):
                msg_dict["content"] = SensitiveDataRedactor.redact_text(msg_dict["content"])
            sanitized_messages.append(msg_dict)

        payload: Dict[str, Any] = {
            "model": request.model,
            "messages": sanitized_messages,
            "max_tokens": request.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True}
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.function.get("name"),
                        "description": t.function.get("description", ""),
                        "parameters": t.function.get("parameters", {})
                    }
                }
                for t in request.tools
            ]
            if request.tool_choice:
                payload["tool_choice"] = request.tool_choice

        # Execute request with retry loop
        last_error = None
        adaptive_retries = set()
        client = get_shared_http_client(self.timeout)
        for attempt in range(self.max_retries + 1):
            try:
                async with client.stream(
                    "POST",
                    url,
                    headers=self._get_headers(),
                    json=payload
                ) as response:
                        if response.status_code != 200:
                            err_body = await response.aread()
                            err_msg = f"HTTP {response.status_code}: {err_text}"
                            if response.status_code in [404, 410]:
                                err_msg += f"\n[Diagnostic]: The requested model '{request.model}' is retired or unavailable. For NVIDIA NIM, use 'meta/llama-3.2-11b-vision-instruct'."

                            if response.status_code == 400:
                                adjustment = self._temperature_adjustment_from_error(err_text)
                                if adjustment and "temperature" in payload:
                                    if adjustment["action"] == "omit":
                                        retry_key = "temperature:omit"
                                        if retry_key not in adaptive_retries:
                                            payload.pop("temperature", None)
                                            adaptive_retries.add(retry_key)
                                            logger.info("Retrying chat completion without temperature after provider rejected it.")
                                            continue
                                    elif adjustment["action"] == "set":
                                        value = adjustment["value"]
                                        retry_key = f"temperature:{value}"
                                        if payload.get("temperature") != value and retry_key not in adaptive_retries:
                                            payload["temperature"] = value
                                            adaptive_retries.add(retry_key)
                                            logger.info("Retrying chat completion with provider-supported temperature=%s.", value)
                                            continue
                            
                            # Handle rate limits (429) and transient server errors
                            if response.status_code in [429, 500, 502, 503, 504] and attempt < self.max_retries:
                                delay = 2 ** (attempt + 1)
                                if response.status_code == 429 or "RESOURCE_EXHAUSTED" in err_text or "rate limit" in err_text.lower():
                                    # Check for Retry-After header or delay specified in error body
                                    retry_header = response.headers.get("retry-after")
                                    if retry_header and retry_header.isdigit():
                                        delay = int(retry_header)
                                    else:
                                        match = re.search(r"(?:retry\s+after|wait|in)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?", err_text, re.IGNORECASE)
                                        if match:
                                            delay = int(float(match.group(1)))
                                        else:
                                            # Default Gemini free tier cooldown window is 35s
                                            delay = 35

                                logger.warning("⚡ Rate limit / transient error encountered. Waiting %ds before automatic retry (attempt %d/%d)...", delay, attempt + 1, self.max_retries)
                                await asyncio.sleep(delay)
                                continue

                            yield StreamEvent(event_type="error", data=err_msg)
                            return

                        tool_call_accumulator: Dict[int, Dict[str, Any]] = {}
                        accumulated_content = ""
                        accumulated_reasoning = ""
                        token_usage: Dict[str, int] = {}

                        async for line in response.aiter_lines():
                            line = line.strip()
                            if not line or not line.startswith("data:"):
                                continue
                            data_str = line[5:].strip()
                            if data_str == "[DONE]":
                                break

                            try:
                                chunk = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            # Capture token usage metadata if included in chunk
                            if "usage" in chunk and chunk["usage"]:
                                u = chunk["usage"]
                                token_usage = {
                                    "prompt_tokens": int(u.get("prompt_tokens", 0)),
                                    "completion_tokens": int(u.get("completion_tokens", 0)),
                                    "total_tokens": int(u.get("total_tokens", 0))
                                }
                                yield StreamEvent(event_type="usage", data=token_usage)

                            choices = chunk.get("choices", [])
                            if not choices:
                                continue
                            delta = choices[0].get("delta", {})

                            # 1. Reasoning Delta
                            reasoning = delta.get("reasoning_content") or delta.get("thought") or delta.get("reasoning")
                            if reasoning:
                                accumulated_reasoning += reasoning
                                yield StreamEvent(event_type="reasoning", data=reasoning)

                            # 2. Content Delta
                            content = delta.get("content")
                            if content:
                                accumulated_content += content
                                yield StreamEvent(event_type="content", data=content)

                            # 3. Tool Calls Delta
                            tool_deltas = delta.get("tool_calls", [])
                            for td in tool_deltas:
                                raw_idx = td.get("index")
                                td_id = td.get("id")
                                func_delta = td.get("function", {})
                                name_delta = func_delta.get("name")
                                args_delta = func_delta.get("arguments")

                                # Match existing accumulator entry by id first
                                target_idx = None
                                if td_id:
                                    for ex_idx, ex_data in tool_call_accumulator.items():
                                        if ex_data.get("id") == td_id:
                                            target_idx = ex_idx
                                            break

                                # If not matched by id, match by raw_idx
                                if target_idx is None:
                                    if raw_idx is not None:
                                        target_idx = raw_idx
                                    else:
                                        if not tool_call_accumulator:
                                            target_idx = 0
                                        else:
                                            last_idx = max(tool_call_accumulator.keys())
                                            last_entry = tool_call_accumulator[last_idx]
                                            # If a new name is specified and last entry already has a complete name, this is a new tool call
                                            if name_delta and last_entry["name"] and last_entry["name"] != name_delta:
                                                target_idx = last_idx + 1
                                            else:
                                                target_idx = last_idx

                                if target_idx not in tool_call_accumulator:
                                    tool_call_accumulator[target_idx] = {
                                        "id": td_id or f"call_{target_idx}_{uuid.uuid4().hex[:8]}",
                                        "name": "",
                                        "arguments": "",
                                        "extra_content": td.get("extra_content")
                                    }

                                if td_id:
                                    tool_call_accumulator[target_idx]["id"] = td_id
                                if td.get("extra_content"):
                                    tool_call_accumulator[target_idx]["extra_content"] = td["extra_content"]

                                if name_delta:
                                    if not tool_call_accumulator[target_idx]["name"]:
                                        tool_call_accumulator[target_idx]["name"] = name_delta
                                    elif tool_call_accumulator[target_idx]["name"] == name_delta:
                                        pass
                                    else:
                                        tool_call_accumulator[target_idx]["name"] += name_delta

                                if args_delta:
                                    tool_call_accumulator[target_idx]["arguments"] += args_delta

                        # Process completed tool calls
                        final_tool_calls: List[ToolCall] = []
                        for idx, tc_data in sorted(tool_call_accumulator.items()):
                            if tc_data["name"]:
                                tc = ToolCall(
                                    id=tc_data["id"],
                                    function={"name": tc_data["name"], "arguments": tc_data["arguments"]},
                                    extra_content=tc_data.get("extra_content")
                                )
                                final_tool_calls.append(tc)
                                yield StreamEvent(event_type="tool_call", data=tc)

                        # Check for inline tool recovery if no native tool calls were emitted
                        if not final_tool_calls and accumulated_content and request.tools:
                            recovered = self._recover_inline_tool_calls(accumulated_content, request.tools)
                            for r_tc in recovered:
                                yield StreamEvent(event_type="tool_call", data=r_tc)

                        yield StreamEvent(event_type="done", data={
                            "content": accumulated_content,
                            "reasoning": accumulated_reasoning,
                            "tool_calls": final_tool_calls,
                            "usage": token_usage
                        })
                        return

            except Exception as e:
                last_error = e
                if attempt < self.max_retries:
                    delay = 2 ** attempt
                    logger.warning("Request failed (%s), retrying in %ds...", e, delay)
                    await asyncio.sleep(delay)
                else:
                    yield StreamEvent(event_type="error", data=f"Client error: {str(e)}")

    def _recover_inline_tool_calls(self, text: str, tools: List[ToolDefinition]) -> List[ToolCall]:
        """Recovers tool calls formatted as inline markdown json blocks."""
        recovered = []
        tool_names = {t.function.get("name") for t in tools if t.function.get("name")}

        # Check for ```json ... ``` code blocks
        json_blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        for block in json_blocks:
            try:
                data = json.loads(block)
                if isinstance(data, dict):
                    name = data.get("name") or data.get("tool") or data.get("action")
                    args = data.get("arguments") or data.get("args") or data.get("parameters") or {}
                    if name in tool_names:
                        recovered.append(ToolCall(
                            id=f"inline_{uuid.uuid4().hex[:8]}",
                            function={"name": name, "arguments": json.dumps(args) if isinstance(args, dict) else str(args)}
                        ))
            except Exception:
                continue

        return recovered
