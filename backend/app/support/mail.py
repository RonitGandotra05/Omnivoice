"""SMTP delivery for the durable ticket outbox. Never send without explicit enablement."""
import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from app.config.settings import get_settings


def send_message(ticket):
    settings = get_settings()
    message = EmailMessage()
    message['From'] = str(settings.smtp_from)
    message['To'] = ticket.recipient
    message['Subject'] = f'[{ticket.priority.upper()}] {ticket.subject}'
    message['Message-ID'] = f'<{ticket.id}@omnivoice.local>'
    if ticket.customer_email:
        message['Reply-To'] = ticket.customer_email
    message.set_content(f'Ticket: {ticket.id}\nCompany: {ticket.company_id}\nTeam: {ticket.team}\n'
        f'Caller email: {ticket.customer_email or "Not supplied"}\nPhone: {ticket.customer_phone or "Not supplied"}\n\n'
        f'{ticket.summary}\n\nTranscript\n{ticket.transcript or "Not supplied"}')
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


async def deliver(ticket):
    settings = get_settings()
    if not settings.email_enabled or not settings.smtp_host or not settings.smtp_from:
        ticket.delivery_status = 'not_configured'
        ticket.delivery_error = 'Email is not configured. Ticket is saved for retry.'
        return
    ticket.attempts += 1
    try:
        await asyncio.to_thread(send_message, ticket)
        ticket.delivery_status = 'sent'
        ticket.delivery_error = None
    except Exception:
        ticket.delivery_status = 'failed'
        ticket.delivery_error = 'SMTP delivery failed. Verify server configuration and retry.'
