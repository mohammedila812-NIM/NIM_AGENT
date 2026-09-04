from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

@dataclass
class ContentPart:
    type: str  # "text" | "image_url"
    text: Optional[str] = None
    image_url: Optional[Dict[str, str]] = None

@dataclass
class ToolCall:
    id: str
    type: str = "function"
    function: Dict[str, str] = field(default_factory=dict)  # {"name": ..., "arguments": "{...}"}
    extra_content: Optional[Dict[str, Any]] = None
    thought_signature: Optional[str] = None

    @property
    def name(self) -> str:
        return self.function.get("name", "")

    @property
    def arguments(self) -> str:
        return self.function.get("arguments", "{}")

@dataclass
class ToolDefinition:
    type: str = "function"
    function: Dict[str, Any] = field(default_factory=dict)  # {"name": ..., "description": ..., "parameters": {...}}

@dataclass
class ChatMessage:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: Optional[Union[str, List[ContentPart]]] = None
    tool_call_id: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    name: Optional[str] = None
    reasoning_content: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_api_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"role": self.role}
        if self.content is not None:
            if isinstance(self.content, list):
                out_parts = []
                for p in self.content:
                    if isinstance(p, ContentPart):
                        if p.type == "text":
                            out_parts.append({"type": "text", "text": p.text or ""})
                        else:
                            out_parts.append({"type": p.type, "image_url": p.image_url})
                    elif isinstance(p, dict):
                        out_parts.append(p)
                    elif isinstance(p, str):
                        out_parts.append({"type": "text", "text": p})
                d["content"] = out_parts
            else:
                d["content"] = str(self.content)
        else:
            d["content"] = None

        if self.reasoning_content:
            d["reasoning_content"] = self.reasoning_content
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        if self.name:
            d["name"] = self.name
        if self.tool_calls:
            import json
            d["tool_calls"] = []
            for tc in self.tool_calls:
                args = tc.arguments
                if isinstance(args, (dict, list)):
                    args = json.dumps(args)
                elif not isinstance(args, str):
                    args = str(args)

                call_item: Dict[str, Any] = {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": args}
                }
                sig = getattr(tc, "thought_signature", None)
                extra = getattr(tc, "extra_content", None)
                if not sig and isinstance(extra, dict):
                    sig = (
                        extra.get("google", {}).get("thought_signature")
                        or extra.get("google", {}).get("thoughtSignature")
                        or extra.get("thought_signature")
                        or extra.get("thoughtSignature")
                    )
                if sig:
                    call_item["thought_signature"] = sig
                    call_item["thoughtSignature"] = sig
                    if not extra:
                        call_item["extra_content"] = {"google": {"thought_signature": sig}}
                if extra:
                    call_item["extra_content"] = extra
                d["tool_calls"].append(call_item)
        return d

@dataclass
class ProviderConfig:
    id: str
    label: str
    base_url: str
    api_key: Optional[str] = None
    default_model: str = "meta/llama-3.3-70b-instruct"

@dataclass
class ChatCompletionRequest:
    model: str
    messages: List[ChatMessage]
    tools: Optional[List[ToolDefinition]] = None
    tool_choice: Optional[str] = "auto"
    temperature: float = 0.2
    max_tokens: int = 4096
    stream: bool = True

@dataclass
class ChatCompletionChunk:
    id: str
    content_delta: Optional[str] = None
    reasoning_delta: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    finish_reason: Optional[str] = None
    usage: Optional[Dict[str, int]] = None

@dataclass
class ChatCompletionResponse:
    id: str
    message: ChatMessage
    finish_reason: Optional[str] = None
    usage: Optional[Dict[str, int]] = None

@dataclass
class StreamEvent:
    event_type: str  # "reasoning", "content", "tool_call", "done", "error"
    data: Any
