from typing import Any, Dict, List, Optional, Union
from .base import BaseTool, ToolContext, ToolResult
from src.perception.email_client import EmailClient
from src.security.guard import ActionRiskLevel
from src.security.redaction import SensitiveDataRedactor

# Shared singleton instance
_email_client: Optional[EmailClient] = None

def get_email_client() -> EmailClient:
    global _email_client
    if _email_client is None:
        _email_client = EmailClient()
    return _email_client

class ReadEmailsTool(BaseTool):
    """
    Reads and summarizes recent emails from Outlook or configured IMAP.
    """
    name = "read_emails"
    description = (
        "Read recent emails from Microsoft Outlook or configured IMAP inbox/folders. "
        "Extracts sender, subject, date, body preview, and attachment filenames."
    )
    parameters = {
        "type": "object",
        "properties": {
            "folder": {"type": "string", "default": "Inbox", "description": "Folder name (e.g. 'Inbox', 'Sent', 'Drafts')."},
            "count": {"type": "integer", "default": 5, "description": "Maximum number of recent emails to read (default: 5)."},
            "unread_only": {"type": "boolean", "default": False, "description": "Only return unread emails."},
            "search_query": {"type": "string", "description": "Optional keyword to filter messages."}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        client = get_email_client()
        folder = str(args.get("folder", "Inbox"))
        count = int(args.get("count", 5))
        unread = bool(args.get("unread_only", False))
        query = args.get("search_query")

        items = client.read_emails(folder_name=folder, count=count, unread_only=unread, search_query=query)
        data = [item.__dict__ for item in items]
        clean_data = SensitiveDataRedactor.redact_dict({"emails": data, "count": len(data)})
        return ToolResult(success=True, data=clean_data)

class SendEmailTool(BaseTool):
    """
    Composes and sends an email via Microsoft Outlook or SMTP with SecurityGuard pre-flight checks.
    """
    name = "send_email"
    description = (
        "Compose and send an email to one or more recipients with optional CC, BCC, and file attachments. "
        "Supports Microsoft Outlook and standard SMTP."
    )
    parameters = {
        "type": "object",
        "properties": {
            "to": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of recipient email addresses (e.g. ['alice@example.com'])."
            },
            "subject": {"type": "string", "description": "Subject line of the email."},
            "body": {"type": "string", "description": "Body text or HTML content."},
            "cc": {"type": "array", "items": {"type": "string"}, "description": "Optional list of CC email addresses."},
            "bcc": {"type": "array", "items": {"type": "string"}, "description": "Optional list of BCC email addresses."},
            "attachments": {"type": "array", "items": {"type": "string"}, "description": "Optional list of file paths to attach."},
            "is_html": {"type": "boolean", "default": False, "description": "Whether the body contains HTML formatting."}
        },
        "required": ["to", "subject", "body"]
    }
    risk_level = ActionRiskLevel.MODERATE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        client = get_email_client()
        to_addrs = args.get("to", [])
        subj = str(args.get("subject", "")).strip()
        body = str(args.get("body", "")).strip()
        cc = args.get("cc")
        bcc = args.get("bcc")
        attach = args.get("attachments")
        is_html = bool(args.get("is_html", False))

        if not to_addrs or not subj or not body:
            return ToolResult(success=False, data=None, error="Fields 'to', 'subject', and 'body' are required.")

        res = client.send_email(
            to=to_addrs,
            subject=subj,
            body=body,
            cc=cc,
            bcc=bcc,
            attachments=attach,
            is_html=is_html
        )
        if not res.get("success"):
            return ToolResult(success=False, data=res, error=res.get("error", "Failed to send email"))

        return ToolResult(success=True, data=res)

class ReplyEmailTool(BaseTool):
    """
    Replies to an email thread in Microsoft Outlook.
    """
    name = "reply_email"
    description = "Reply to an existing email by subject or entry ID."
    parameters = {
        "type": "object",
        "properties": {
            "search_subject": {"type": "string", "description": "Subject of the email to reply to."},
            "body": {"type": "string", "description": "Reply body text."},
            "reply_all": {"type": "boolean", "default": False, "description": "Reply to all recipients."}
        },
        "required": ["search_subject", "body"]
    }
    risk_level = ActionRiskLevel.MODERATE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        client = get_email_client()
        search_subj = str(args.get("search_subject", "")).strip()
        reply_body = str(args.get("body", "")).strip()

        # Find the original email
        emails = client.read_emails(count=10, search_query=search_subj)
        if not emails:
            return ToolResult(success=False, data=None, error=f"Could not find email matching subject '{search_subj}' to reply to.")

        target = emails[0]
        # Dispatch reply
        res = client.send_email(
            to=target.sender,
            subject=f"Re: {target.subject.removeprefix('Re: ').strip()}",
            body=reply_body
        )
        return ToolResult(success=res.get("success", False), data=res)

class SearchEmailsTool(BaseTool):
    """
    Searches emails by keyword, sender, or subject.
    """
    name = "search_emails"
    description = "Search your email inbox and folders by keyword, sender, or date."
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search keyword or sender name/email."},
            "folder": {"type": "string", "default": "Inbox", "description": "Folder to search."},
            "max_results": {"type": "integer", "default": 10, "description": "Max results to return."}
        },
        "required": ["query"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        client = get_email_client()
        query = str(args.get("query", "")).strip()
        folder = str(args.get("folder", "Inbox"))
        max_r = int(args.get("max_results", 10))

        items = client.read_emails(folder_name=folder, count=max_r, search_query=query)
        data = [item.__dict__ for item in items]
        clean_data = SensitiveDataRedactor.redact_dict({"emails": data, "count": len(data)})
        return ToolResult(success=True, data=clean_data)

class TrackEmailReplyTool(BaseTool):
    """
    Registers an automated follow-up reminder in the scheduler if a recipient does not reply within N days.
    """
    name = "track_email_reply"
    description = (
        "Set an automated follow-up reminder in the scheduler: "
        "JARVIS will check in N days if the recipient has replied, and alert you if follow-up is needed."
    )
    parameters = {
        "type": "object",
        "properties": {
            "recipient": {"type": "string", "description": "Recipient name or email address."},
            "subject": {"type": "string", "description": "Subject of the email thread to track."},
            "remind_after_days": {"type": "number", "default": 3.0, "description": "Days to wait before checking for a reply (default: 3)."}
        },
        "required": ["recipient", "subject"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        client = get_email_client()
        recip = str(args.get("recipient", "")).strip()
        subj = str(args.get("subject", "")).strip()
        days = float(args.get("remind_after_days", 3.0))

        if not recip or not subj:
            return ToolResult(success=False, data=None, error="Both 'recipient' and 'subject' are required.")

        res = client.track_followup_reminder(recipient=recip, subject=subj, remind_after_days=days)
        return ToolResult(success=True, data=res)
