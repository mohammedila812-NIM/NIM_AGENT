import logging
import re
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup
import httpx
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from src.security.secrets import get_secret_store

logger = logging.getLogger(__name__)

class WebSearchTool(BaseTool):
    name = "web_search"
    description = (
        "Search the live web for news, facts, documentation, or articles. "
        "Returns top search results with titles, snippets, sources, and URLs."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query or topic (e.g. 'latest world news today', 'NVIDIA NIM docs')."},
            "category": {"type": "string", "enum": ["general", "news"], "default": "general", "description": "Search category: 'news' for live headlines or 'general' for web search."},
            "max_results": {"type": "integer", "description": "Maximum results to return (default: 8).", "default": 8}
        },
        "required": ["query"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        query = str(args.get("query", "")).strip()
        category = str(args.get("category", "general")).lower()
        max_results = int(args.get("max_results", 8))

        if not query:
            return ToolResult(success=False, data=None, error="No search query provided.")

        results = []

        # 1. Check if user configured a Brave Search API key
        secret_store = get_secret_store()
        brave_key = secret_store.get_key("search_api") or secret_store.get_key("brave")
        if brave_key:
            results = await self._search_brave(query, brave_key, max_results)

        # 2. If no Brave key or no results, query Google News / RSS feed for news or topic search
        if not results:
            if "news" in query.lower() or category == "news":
                results = await self._search_news_rss(query, max_results)
            else:
                results = await self._search_general(query, max_results)

        if not results:
            # Fallback to news RSS if general search was empty
            results = await self._search_news_rss(query, max_results)

        return ToolResult(
            success=True,
            data={
                "query": query,
                "count": len(results),
                "results": results
            }
        )

    async def _search_brave(self, query: str, api_key: str, max_results: int) -> List[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
                    params={"q": query, "count": max_results}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    web_results = data.get("web", {}).get("results", [])
                    return [
                        {
                            "title": item.get("title"),
                            "snippet": item.get("description"),
                            "url": item.get("url")
                        }
                        for item in web_results[:max_results]
                    ]
        except Exception as e:
            logger.warning("Brave search error: %s", e)
        return []

    async def _search_news_rss(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        try:
            encoded_query = urllib.parse.quote(query)
            # If broad news query, get top headlines, else query topic
            if query.lower() in ["news", "latest news", "latest world news", "top headlines", "world news"]:
                url = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"
            else:
                url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-US&gl=US&ceid=US:en"

            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                if resp.status_code == 200:
                    root = ET.fromstring(resp.content)
                    items = root.findall(".//item")
                    results = []
                    for item in items[:max_results]:
                        title = item.find("title").text if item.find("title") is not None else "No Title"
                        link = item.find("link").text if item.find("link") is not None else ""
                        pub_date = item.find("pubDate").text if item.find("pubDate") is not None else ""
                        source = item.find("source").text if item.find("source") is not None else ""
                        results.append({
                            "title": title,
                            "source": source,
                            "published": pub_date,
                            "url": link
                        })
                    return results
        except Exception as e:
            logger.warning("News RSS search error: %s", e)
        return []

    async def _search_general(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        try:
            # DuckDuckGo HTML Lite search
            encoded = urllib.parse.quote(query)
            url = f"https://html.duckduckgo.com/html/?q={encoded}"
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                )
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    results = []
                    for result in soup.find_all("div", class_="result"):
                        if len(results) >= max_results:
                            break
                        title_tag = result.find("a", class_="result__a")
                        snippet_tag = result.find("a", class_="result__snippet")
                        if title_tag:
                            raw_href = title_tag.get("href", "")
                            clean_url = raw_href
                            if "uddg=" in raw_href:
                                parsed = urllib.parse.urlparse(raw_href)
                                qs = urllib.parse.parse_qs(parsed.query)
                                if "uddg" in qs and qs["uddg"]:
                                    clean_url = qs["uddg"][0]

                            results.append({
                                "title": title_tag.get_text(strip=True),
                                "url": clean_url,
                                "snippet": snippet_tag.get_text(strip=True) if snippet_tag else ""
                            })
                    return results
        except Exception as e:
            logger.warning("General web search error: %s", e)
        return []

class ReadUrlTool(BaseTool):
    name = "read_url"
    description = "Fetch and extract the readable text content of a specific web URL."
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The web URL to fetch."},
            "max_length": {"type": "integer", "description": "Maximum characters to return (default: 4000).", "default": 4000}
        },
        "required": ["url"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        url = str(args.get("url", "")).strip()
        max_len = int(args.get("max_length", 4000))

        if not url:
            return ToolResult(success=False, data=None, error="No URL provided.")

        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                )
                if resp.status_code != 200:
                    return ToolResult(success=False, data=None, error=f"HTTP {resp.status_code} fetching URL")

                soup = BeautifulSoup(resp.text, "html.parser")
                # Remove scripts, styles, navigations
                for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
                    tag.decompose()

                text = soup.get_text(separator="\n", strip=True)
                clean_text = re.sub(r"\n{3,}", "\n\n", text)

                return ToolResult(
                    success=True,
                    data={
                        "url": url,
                        "title": soup.title.string if soup.title else "",
                        "content": clean_text[:max_len],
                        "truncated": len(clean_text) > max_len
                    }
                )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to fetch URL: {str(e)}")
