import email
import imaplib
import logging
import os
import smtplib
import time
from dataclasses import dataclass, field
from datetime import datetime
from email.header import decode_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    import win32com.client
    import pythoncom
    HAS_WIN32_COM = True
except ImportError:
    HAS_WIN32_COM = False

from src.security.redaction import SensitiveDataRedactor
from src.triggers.scheduler import SchedulerEngine
from src.tools.scheduler_tools import get_scheduler_engine

logger = logging.getLogger(__name__)

@dataclass
class EmailMessageItem:
    id: str
    subject: str
    sender: str
    to: List[str]
    received_time: str
    body_preview: str
    unread: bool = False
    has_attachments: bool = False
    attachment_names: List[str] = field(default_factory=list)
    raw_body: Optional[str] = None

class EmailClient:
    """
    Unified Memory-Aware Email Client for NIM JARVIS Desktop.
    Supports Microsoft Outlook (via Win32 COM) and standard IMAP/SMTP backends.
    """

    def __init__(
        self,
        smtp_host: Optional[str] = None,
        smtp_port: int = 587,
        imap_host: Optional[str] = None,
        imap_port: int = 993,
        username: Optional[str] = None,
        password: Optional[str] = None
    ):
        self.smtp_host = smtp_host or os.environ.get("JARVIS_SMTP_HOST")
        self.smtp_port = int(os.environ.get("JARVIS_SMTP_PORT", smtp_port))
        self.imap_host = imap_host or os.environ.get("JARVIS_IMAP_HOST")
        self.imap_port = int(os.environ.get("JARVIS_IMAP_PORT", imap_port))
        self.username = username or os.environ.get("JARVIS_EMAIL_USER")
        self.password = password or os.environ.get("JARVIS_EMAIL_PASS")
        self._outlook_app = None

    def _get_outlook(self):
        """Attempts to connect to Microsoft Outlook via Win32 COM."""
        if not HAS_WIN32_COM:
            return None
        try:
            pythoncom.CoInitialize()
            if self._outlook_app is None:
                self._outlook_app = win32com.client.Dispatch("Outlook.Application")
            return self._outlook_app
        except Exception as e:
            logger.debug("Outlook COM not available: %s", e)
            return None

    # -------------------------------------------------------------------------
    # 1. Reading Emails (Outlook COM or IMAP)
    # -------------------------------------------------------------------------

    def read_emails(
        self,
        folder_name: str = "Inbox",
        count: int = 10,
        unread_only: bool = False,
        search_query: Optional[str] = None
    ) -> List[EmailMessageItem]:
        """Reads recent emails from Outlook or configured IMAP."""
        outlook = self._get_outlook()
        if outlook:
            return self._read_outlook_emails(folder_name=folder_name, count=count, unread_only=unread_only, search_query=search_query)
        elif self.imap_host and self.username and self.password:
            return self._read_imap_emails(folder_name=folder_name, count=count, unread_only=unread_only, search_query=search_query)
        else:
            logger.info("Neither Outlook nor IMAP configured. Returning mock/empty list.")
            return []

    def _read_outlook_emails(
        self,
        folder_name: str = "Inbox",
        count: int = 10,
        unread_only: bool = False,
        search_query: Optional[str] = None
    ) -> List[EmailMessageItem]:
        results: List[EmailMessageItem] = []
        try:
            pythoncom.CoInitialize()
            outlook = self._get_outlook()
            if not outlook:
                return []
            namespace = outlook.GetNamespace("MAPI")
            
            # 6 = olFolderInbox
            folder_id = 6
            if folder_name.lower() in ["sent", "sent items"]:
                folder_id = 5
            elif folder_name.lower() in ["drafts"]:
                folder_id = 16

            folder = namespace.GetDefaultFolder(folder_id)
            items = folder.Items
            items.Sort("[ReceivedTime]", True)

            idx = 0
            for item in items:
                if idx >= count:
                    break
                try:
                    # Filter out non-mail items (e.g. meeting requests) if necessary
                    if not hasattr(item, "Subject"):
                        continue

                    unread = getattr(item, "UnRead", False)
                    if unread_only and not unread:
                        continue

                    subj = str(item.Subject or "")
                    sender = str(getattr(item, "SenderName", "") or getattr(item, "SenderEmailAddress", ""))
                    body = str(getattr(item, "Body", "") or "")

                    if search_query:
                        sq = search_query.lower()
                        if sq not in subj.lower() and sq not in body.lower() and sq not in sender.lower():
                            continue

                    # Extract attachments
                    attach_names = []
                    has_att = False
                    if hasattr(item, "Attachments") and item.Attachments.Count > 0:
                        has_att = True
                        for i in range(1, item.Attachments.Count + 1):
                            attach_names.append(item.Attachments.Item(i).FileName)

                    recv_time = str(getattr(item, "ReceivedTime", ""))
                    msg_id = getattr(item, "EntryID", f"msg_{idx}")

                    results.append(EmailMessageItem(
                        id=msg_id,
                        subject=subj,
                        sender=sender,
                        to=[str(getattr(item, "To", ""))],
                        received_time=recv_time,
                        body_preview=body[:300].strip(),
                        raw_body=body,
                        unread=unread,
                        has_attachments=has_att,
                        attachment_names=attach_names
                    ))
                    idx += 1
                except Exception as item_err:
                    logger.debug("Error parsing Outlook item: %s", item_err)

        except Exception as e:
            logger.error("Outlook read error: %s", e)

        return results

    def _read_imap_emails(
        self,
        folder_name: str = "INBOX",
        count: int = 10,
        unread_only: bool = False,
        search_query: Optional[str] = None
    ) -> List[EmailMessageItem]:
        results: List[EmailMessageItem] = []
        try:
            mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            mail.login(self.username, self.password)
            mail.select(folder_name)

            criterion = "UNSEEN" if unread_only else "ALL"
            if search_query:
                criterion = f'(BODY "{search_query}")'

            _, data = mail.search(None, criterion)
            mail_ids = data[0].split()
            # Fetch latest
            latest_ids = mail_ids[-count:] if len(mail_ids) > count else mail_ids
            latest_ids.reverse()

            for mid in latest_ids:
                _, msg_data = mail.fetch(mid, "(RFC822)")
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)

                # Decode Subject
                subj_raw = msg.get("Subject", "")
                dh = decode_header(subj_raw)
                subj = "".join(
                    t.decode(enc or "utf-8", errors="ignore") if isinstance(t, bytes) else str(t)
                    for t, enc in dh
                )

                sender = msg.get("From", "")
                to_addr = [msg.get("To", "")]
                date_str = msg.get("Date", "")

                body_text = ""
                attach_names = []
                if msg.is_multipart():
                    for part in msg.walk():
                        content_type = part.get_content_type()
                        content_disp = str(part.get("Content-Disposition", ""))
                        if "attachment" in content_disp:
                            fname = part.get_filename() or "attachment"
                            attach_names.append(fname)
                        elif content_type == "text/plain" and not body_text:
                            payload = part.get_payload(decode=True)
                            if payload:
                                body_text = payload.decode(errors="ignore")
                else:
                    payload = msg.get_payload(decode=True)
                    if payload:
                        body_text = payload.decode(errors="ignore")

                results.append(EmailMessageItem(
                    id=mid.decode("utf-8"),
                    subject=subj,
                    sender=sender,
                    to=to_addr,
                    received_time=date_str,
                    body_preview=body_text[:300].strip(),
                    raw_body=body_text,
                    has_attachments=len(attach_names) > 0,
                    attachment_names=attach_names
                ))

            mail.close()
            mail.logout()
        except Exception as e:
            logger.error("IMAP read error: %s", e)

        return results

    # -------------------------------------------------------------------------
    # 2. Sending Emails (Outlook COM or SMTP)
    # -------------------------------------------------------------------------

    def send_email(
        self,
        to: Union[str, List[str]],
        subject: str,
        body: str,
        cc: Optional[Union[str, List[str]]] = None,
        bcc: Optional[Union[str, List[str]]] = None,
        attachments: Optional[List[str]] = None,
        is_html: bool = False
    ) -> Dict[str, Any]:
        """Composes and dispatches an email."""
        to_list = [to] if isinstance(to, str) else (to or [])
        cc_list = [cc] if isinstance(cc, str) else (cc or [])
        bcc_list = [bcc] if isinstance(bcc, str) else (bcc or [])
        attach_list = attachments or []

        # Redact sensitive data from preview
        clean_body = SensitiveDataRedactor.redact_text(body)

        outlook = self._get_outlook()
        if outlook:
            return self._send_outlook(to_list, subject, body, cc_list, bcc_list, attach_list, is_html)
        elif self.smtp_host and self.username and self.password:
            return self._send_smtp(to_list, subject, body, cc_list, bcc_list, attach_list, is_html)
        else:
            return {
                "success": False,
                "error": "No email backend configured. Please open Microsoft Outlook or set JARVIS_SMTP_HOST/JARVIS_EMAIL_USER/JARVIS_EMAIL_PASS."
            }

    def _send_outlook(
        self,
        to_list: List[str],
        subject: str,
        body: str,
        cc_list: List[str],
        bcc_list: List[str],
        attachments: List[str],
        is_html: bool
    ) -> Dict[str, Any]:
        try:
            pythoncom.CoInitialize()
            outlook = self._get_outlook()
            # 0 = olMailItem
            mail = outlook.CreateItem(0)
            mail.Subject = subject
            mail.To = "; ".join(to_list)
            if cc_list:
                mail.CC = "; ".join(cc_list)
            if bcc_list:
                mail.BCC = "; ".join(bcc_list)

            if is_html:
                mail.HTMLBody = body
            else:
                mail.Body = body

            for att in attachments:
                if os.path.exists(att):
                    mail.Attachments.Add(os.path.abspath(att))

            mail.Send()
            return {
                "success": True,
                "backend": "Outlook COM",
                "to": to_list,
                "subject": subject,
                "attachments_count": len(attachments),
                "message": f"Email sent via Outlook to {', '.join(to_list)}"
            }
        except Exception as e:
            return {"success": False, "backend": "Outlook COM", "error": str(e)}

    def _send_smtp(
        self,
        to_list: List[str],
        subject: str,
        body: str,
        cc_list: List[str],
        bcc_list: List[str],
        attachments: List[str],
        is_html: bool
    ) -> Dict[str, Any]:
        try:
            msg = MIMEMultipart()
            msg["From"] = self.username
            msg["To"] = ", ".join(to_list)
            msg["Subject"] = subject
            if cc_list:
                msg["Cc"] = ", ".join(cc_list)

            msg.attach(MIMEText(body, "html" if is_html else "plain"))

            for att in attachments:
                if os.path.exists(att):
                    p = Path(att)
                    part = MIMEBase("application", "octet-stream")
                    with open(att, "rb") as f:
                        part.set_payload(f.read())
                    encoders.encode_base64(part)
                    part.add_header("Content-Disposition", f'attachment; filename="{p.name}"')
                    msg.attach(part)

            all_recipients = to_list + cc_list + bcc_list
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.username, self.password)
                server.sendmail(self.username, all_recipients, msg.as_string())

            return {
                "success": True,
                "backend": "SMTP",
                "to": to_list,
                "subject": subject,
                "message": f"Email sent via SMTP to {', '.join(to_list)}"
            }
        except Exception as e:
            return {"success": False, "backend": "SMTP", "error": str(e)}

    # -------------------------------------------------------------------------
    # 3. Follow-Up Tracking Hook
    # -------------------------------------------------------------------------

    def track_followup_reminder(
        self,
        recipient: str,
        subject: str,
        remind_after_days: float = 3.0
    ) -> Dict[str, Any]:
        """
        Schedules a background check in the SchedulerEngine to alert if the recipient
        has not replied after N days.
        """
        engine = get_scheduler_engine()
        delay_seconds = remind_after_days * 86400.0
        goal = f"Check if {recipient} replied to email thread: '{subject}'. If not, notify me to follow up."
        label = f"Follow-up: {recipient} ({subject[:25]})"

        res = engine.schedule(
            goal=goal,
            expression=f"in {int(delay_seconds)} seconds",
            label=label
        )
        return {
            "success": True,
            "recipient": recipient,
            "subject": subject,
            "remind_after_days": remind_after_days,
            "scheduler_task_id": res.get("task_id"),
            "message": f"Follow-up reminder set for {recipient} in {remind_after_days} days."
        }
