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

class LLMClient:
    """
    Unified Async LLM Client supporting OpenAI-compatible endpoints (NVIDIA NIM, Groq, Gemini, Local).
    Implements streaming SSE, robust retry policies, and structured tool parsing.
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
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True}
        }
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
        for attempt in range(self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    async with client.stream(
                        "POST",
                        url,
                        headers=self._get_headers(),
                        json=payload
                    ) as response:
                        if response.status_code != 200:
                            err_body = await response.aread()
                            err_text = err_body.decode('utf-8', errors='ignore')
                            err_msg = f"HTTP {response.status_code}: {err_text}"
                            
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

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        system: str = "",
        tools: Optional[List[ToolDefinition]] = None,
        max_tokens: int = 4096,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Non-streaming chat generation method for subagents and background workers.
        Returns a dict: {"content": str, "tool_calls": List[dict], "usage": dict}
        """
        chat_messages = []
        if system:
            chat_messages.append(ChatMessage(role="system", content=system))

        for m in messages:
            role = m.get("role", "user")
            content = m.get("content")
            tc_list = m.get("tool_calls")
            tc_objs = None
            if tc_list:
                tc_objs = []
                for tc in tc_list:
                    if isinstance(tc, ToolCall):
                        tc_objs.append(tc)
                    elif isinstance(tc, dict):
                        tc_objs.append(ToolCall(
                            id=tc.get("id", f"call_{uuid.uuid4().hex[:8]}"),
                            function=tc.get("function", {"name": tc.get("name", ""), "arguments": tc.get("arguments", {})})
                        ))
            chat_messages.append(ChatMessage(
                role=role,
                content=content,
                tool_calls=tc_objs,
                tool_call_id=m.get("tool_call_id"),
                name=m.get("name")
            ))

        # Default model if not explicitly specified
        active_model = model or "default"
        try:
            from src.config import AgentConfig
            active_model = model or AgentConfig().model
        except Exception:
            pass

        req = ChatCompletionRequest(
            model=active_model,
            messages=chat_messages,
            tools=tools,
            temperature=0.2,
            max_tokens=max_tokens,
            stream=True
        )

        accumulated_content = ""
        accumulated_reasoning = ""
        accumulated_tool_calls: List[ToolCall] = []
        usage: Dict[str, Any] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

        async for ev in self.stream_chat(req):
            if ev.event_type == "content":
                accumulated_content += ev.data
            elif ev.event_type == "reasoning":
                accumulated_reasoning += ev.data
            elif ev.event_type == "tool_call":
                accumulated_tool_calls.append(ev.data)
            elif ev.event_type == "usage":
                usage = ev.data
            elif ev.event_type == "done" and isinstance(ev.data, dict):
                accumulated_content = ev.data.get("content", accumulated_content)
                accumulated_tool_calls = ev.data.get("tool_calls", accumulated_tool_calls)
                usage = ev.data.get("usage", usage)
            elif ev.event_type == "error":
                raise RuntimeError(str(ev.data))

        formatted_tool_calls = []
        for tc in accumulated_tool_calls:
            formatted_tool_calls.append({
                "id": tc.id,
                "name": tc.function.get("name", "") if isinstance(tc.function, dict) else getattr(tc, "name", ""),
                "arguments": tc.function.get("arguments", {}) if isinstance(tc.function, dict) else getattr(tc, "arguments", {})
            })

        return {
            "content": accumulated_content,
            "reasoning": accumulated_reasoning,
            "tool_calls": formatted_tool_calls,
            "usage": usage
        }
