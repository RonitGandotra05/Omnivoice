"""Explicit offline migration/rotation. Stop app traffic, back up DB and keys first.
Run from backend: .venv/bin/python -m scripts.encrypt_support_data
Environment must have a configured active key; legacy reads true only for migration.
"""
import asyncio
from sqlalchemy import select, text
from sqlalchemy.orm.attributes import flag_modified
from app.config.database import engine, async_session
from app.config.settings import get_settings
from app.support.models import SupportProfile, SupportDocument, SupportDocumentReview, SupportTicket, SupportConversation, SupportCheckSuite, SupportCaller
from app.security.encryption import SecureText, SecureJSON, keyring

MODELS = (SupportProfile, SupportDocument, SupportDocumentReview, SupportTicket, SupportConversation, SupportCheckSuite, SupportCaller)

async def main():
    if not get_settings().data_encryption_active_key or not keyring():
        raise RuntimeError('Configure a real active data encryption key before migration.')
    async with engine.begin() as connection:
        if connection.dialect.name == 'postgresql':
            for model in MODELS:
                for column in model.__table__.columns:
                    if isinstance(column.type, SecureText):
                        # Identifiers come exclusively from static ORM definitions.
                        await connection.execute(text(f'ALTER TABLE "{model.__tablename__}" ALTER COLUMN "{column.name}" TYPE TEXT'))
    async with async_session() as db:
        for model in MODELS:
            fields = [c.name for c in model.__table__.columns if isinstance(c.type, (SecureText, SecureJSON))]
            # Bounded pages; commit each page. Safe to rerun after interruption.
            offset = 0
            primary = list(model.__table__.primary_key.columns)[0]
            while True:
                rows = (await db.execute(select(model).order_by(primary).offset(offset).limit(100))).scalars().all()
                if not rows:
                    break
                for row in rows:
                    for field in fields:
                        if getattr(row, field) is not None:
                            flag_modified(row, field)
                await db.commit()
                offset += len(rows)
                db.expunge_all()
    print('Support fields migrated to the active encryption key. Disable legacy plaintext reads before production startup.')
    await engine.dispose()

if __name__ == '__main__':
    asyncio.run(main())
