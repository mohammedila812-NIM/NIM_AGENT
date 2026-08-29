import pytest
from unittest.mock import MagicMock, patch

from src.perception.email_client import EmailClient, EmailMessageItem
from src.tools.email_tools import (
    ReadEmailsTool,
    SendEmailTool,
    ReplyEmailTool,
    SearchEmailsTool,
    TrackEmailReplyTool,
    get_email_client
)
from src.tools.base import ToolContext
from src.security.guard import SecurityGuard, ActionRiskLevel

@pytest.fixture
def email_client():
    return EmailClient()

def test_read_emails_mock(email_client):
    sample_emails = [
        EmailMessageItem(
            id="msg_1",
            subject="Q3 Financial Overview",
            sender="cfo@company.com",
            to=["user@company.com"],
            received_time="2026-08-29 10:00",
            body_preview="Please find attached the Q3 revenue metrics...",
            has_attachments=True,
            attachment_names=["q3_report.xlsx"]
        )
    ]

    with patch.object(email_client, "_read_outlook_emails", return_value=sample_emails), \
         patch.object(email_client, "_get_outlook", return_value=MagicMock()):
        
        items = email_client.read_emails(count=5)
        assert len(items) == 1
        assert items[0].subject == "Q3 Financial Overview"
        assert items[0].sender == "cfo@company.com"
        assert items[0].attachment_names == ["q3_report.xlsx"]

def test_send_email_mock(email_client):
    with patch.object(email_client, "_send_outlook", return_value={"success": True, "backend": "Outlook COM", "to": ["alice@example.com"]}), \
         patch.object(email_client, "_get_outlook", return_value=MagicMock()):
        
        res = email_client.send_email(
            to=["alice@example.com"],
            subject="Project Sync",
            body="Here is the project proposal."
        )
        assert res["success"] is True
        assert res["backend"] == "Outlook COM"

def test_track_followup_reminder(email_client):
    with patch("src.perception.email_client.get_scheduler_engine") as mock_get_sched:
        mock_sched = MagicMock()
        mock_sched.schedule.return_value = {"success": True, "task_id": "sched_followup_123"}
        mock_get_sched.return_value = mock_sched

        res = email_client.track_followup_reminder(
            recipient="bob@client.com",
            subject="Contract Agreement",
            remind_after_days=2.0
        )
        assert res["success"] is True
        assert res["scheduler_task_id"] == "sched_followup_123"
        mock_sched.schedule.assert_called_once()

@pytest.mark.asyncio
async def test_email_tools():
    ctx = ToolContext(task_id="test_email_ctx")

    with patch("src.tools.email_tools.get_email_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.read_emails.return_value = [
            EmailMessageItem(
                id="msg_2",
                subject="Weekly Update",
                sender="team@example.com",
                to=["user@example.com"],
                received_time="2026-08-29 09:00",
                body_preview="Weekly progress summary..."
            )
        ]
        mock_client.send_email.return_value = {"success": True, "to": ["test@example.com"]}
        mock_client.track_followup_reminder.return_value = {"success": True, "scheduler_task_id": "sched_99"}
        mock_get_client.return_value = mock_client

        # 1. ReadEmailsTool
        read_tool = ReadEmailsTool()
        res_read = await read_tool.execute({"count": 5}, ctx)
        assert res_read.success is True
        assert res_read.data["count"] == 1

        # 2. SendEmailTool
        send_tool = SendEmailTool()
        res_send = await send_tool.execute({"to": ["test@example.com"], "subject": "Test", "body": "Hello"}, ctx)
        assert res_send.success is True

        # 3. ReplyEmailTool
        reply_tool = ReplyEmailTool()
        res_reply = await reply_tool.execute({"search_subject": "Weekly Update", "body": "Thanks for the update!"}, ctx)
        assert res_reply.success is True

        # 4. SearchEmailsTool
        search_tool = SearchEmailsTool()
        res_search = await search_tool.execute({"query": "Weekly"}, ctx)
        assert res_search.success is True

        # 5. TrackEmailReplyTool
        track_tool = TrackEmailReplyTool()
        res_track = await track_tool.execute({"recipient": "alice@corp.com", "subject": "Quarterly Budget"}, ctx)
        assert res_track.success is True

def test_security_guard_email_risks():
    # Normal safe email
    assert SecurityGuard.evaluate_tool_call("send_email", {"to": ["alice@company.com"], "subject": "Lunch", "body": "Hey"}) == ActionRiskLevel.MODERATE

    # Mass recipient list (>5)
    mass_recipients = [f"user{i}@example.com" for i in range(10)]
    assert SecurityGuard.evaluate_tool_call("send_email", {"to": mass_recipients, "subject": "Announcement", "body": "Hi"}) == ActionRiskLevel.DESTRUCTIVE

    # Financial / wire transfer keywords
    assert SecurityGuard.evaluate_tool_call("send_email", {"to": ["vendor@partner.com"], "subject": "Urgent Invoice payment", "body": "Please wire transfer funds to bank routing 12345"}) == ActionRiskLevel.DESTRUCTIVE
