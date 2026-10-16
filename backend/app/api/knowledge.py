"""
Knowledge API – Upload, list, and delete knowledge base documents.
"""

import uuid
import logging
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config.database import get_db
from app.config.settings import get_settings
from app.models.models import Company, KnowledgeDocument
from app.models.schemas import DocumentResponse
from app.utils.elevenlabs_client import company_agent_id, provider_request, attach_knowledge, detach_knowledge
from app.utils.access import require_operator
from app.utils.document_parser import get_supported_types
from app.utils.parse_async import parse_isolated

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_operator)])
settings = get_settings()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.get("")
async def list_documents(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List all knowledge documents for a company."""
    result = await db.execute(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.company_id == company_id)
        .order_by(KnowledgeDocument.uploaded_at.desc())
    )
    docs = result.scalars().all()
    return {"documents": [DocumentResponse.model_validate(d) for d in docs]}


@router.post("", status_code=202)
async def upload_document(
    company_id: UUID = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document and index it into the vector store."""

    # Validate company
    company_q = await db.execute(
        select(Company.id).where(Company.id == company_id)
    )
    if company_q.scalar_one_or_none() is None:
        raise HTTPException(404, "Company not found")

    try:
        agent_id = company_agent_id(company_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    # Validate file
    from app.security.uploads import filename_extension
    try:
        ext = filename_extension(file.filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    supported = get_supported_types()
    if ext not in supported:
        raise HTTPException(
            400, f"Unsupported file type '{ext}'. Supported: {', '.join(supported)}"
        )

    buffer = await file.read(MAX_FILE_SIZE + 1)
    if len(buffer) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Max {MAX_FILE_SIZE // (1024*1024)}MB")

    # Security errors must be returned before creating records or invoking providers.
    parsed = await parse_isolated(buffer, ext)

    # Create DB record
    doc_id = uuid.uuid4()
    namespace = f"company_{company_id}"
    doc = KnowledgeDocument(
        id=doc_id,
        company_id=company_id,
        filename=f"{doc_id}.{ext}",
        original_name=file.filename,
        content_type=ext,
        file_size=len(buffer),
        pinecone_namespace=namespace,
        status="processing",
    )
    db.add(doc)
    await db.flush()

    # Parse & index (inline for now – could be background task)
    # We'll extract text and upload it directly to ElevenLabs Knowledge Base
    try:
        if parsed.get("metadata", {}).get("needs_review"):
            raise ValueError("OCR text requires review. Upload through the company workspace instead.")
        content = parsed["content"]

        if len(content) < 10:
            raise ValueError("Document appears to be empty or too short")

        logger.info("Parsed %d document characters", len(content))

        el_data = await provider_request("POST", "/knowledge-base/text", json={
            "text": content, "name": f"{company_id}/{file.filename}"
        })
        # Keep the legacy DB column so existing databases need no destructive migration.
        doc.pinecone_namespace = el_data["id"]
        await attach_knowledge(agent_id, el_data["id"], el_data.get("name", file.filename))

        doc.status = "indexed"
        doc.chunk_count = 0  # Provider manages indexing; no fabricated local chunk count
        doc.indexed_at = datetime.utcnow()

    except Exception as exc:
        logger.exception("Failed to process document %s", doc_id)
        doc.status = "failed"
        doc.error_message = "Provider upload or attachment failed. Check the dedicated company agent configuration."

    await db.flush()

    return {
        "message": "Knowledge attached to company agent" if doc.status == "indexed" else "Knowledge processing failed",
        "documentId": str(doc_id),
        "status": doc.status,
        "chunkCount": doc.chunk_count,
    }


@router.delete("/{document_id}")
async def delete_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a knowledge document."""
    result = await db.execute(
        select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, "Document not found")

    if doc.pinecone_namespace and not doc.pinecone_namespace.startswith("company_"):
        try:
            await detach_knowledge(company_agent_id(doc.company_id), doc.pinecone_namespace)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(502, "Provider removal failed; local document retained for retry.") from exc
    await db.delete(doc)
    await db.flush()

    return {"message": "Document deleted"}
