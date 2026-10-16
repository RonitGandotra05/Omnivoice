"""Versioned AES-256-GCM field encryption with purpose-bound authenticated data."""
import base64
import json
import os
import re
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.types import TypeDecorator, Text, JSON
from app.config.settings import get_settings

PREFIX = 'ovenc:v1:'
RAW_PREFIX = 'ovraw:v1:'


def keyring():
    settings = get_settings()
    keys = {}
    for name, encoded in settings.data_encryption_keys.items():
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', name):
            raise ValueError('Invalid data encryption key ID.')
        try:
            key = base64.b64decode(encoded, altchars=b'-_', validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError('Data encryption keys must be base64-encoded 32-byte random values.') from exc
        if len(key) != 32:
            raise ValueError('Data encryption keys must contain exactly 32 bytes.')
        keys[name] = key
    if settings.data_encryption_active_key and settings.data_encryption_active_key not in keys:
        raise ValueError('The active data encryption key is missing.')
    return keys


def seal(value, purpose):
    if value is None:
        return None
    settings = get_settings()
    if not settings.data_encryption_active_key:
        if settings.production_mode:
            raise ValueError('Data encryption is required in production.')
        # Escape reserved markers in local plaintext mode; an uploaded string must
        # never be mistaken for an existing ciphertext envelope on its next read.
        return RAW_PREFIX + base64.urlsafe_b64encode(value.encode()).decode() if value.startswith((PREFIX, RAW_PREFIX)) else value
    name = settings.data_encryption_active_key
    nonce = os.urandom(12)
    ciphertext = AESGCM(keyring()[name]).encrypt(nonce, value.encode(), f'omnivoice:v1:{name}:{purpose}'.encode())
    return PREFIX + name + ':' + base64.urlsafe_b64encode(nonce + ciphertext).decode()


def unseal(value, purpose):
    if value is None:
        return None
    if value.startswith(RAW_PREFIX):
        if not get_settings().allow_legacy_plaintext_reads:
            raise ValueError('Local plaintext data requires migration.')
        return base64.urlsafe_b64decode(value[len(RAW_PREFIX):]).decode()
    if not value.startswith(PREFIX):
        if not get_settings().allow_legacy_plaintext_reads:
            raise ValueError('Unencrypted legacy data requires an explicit migration.')
        return value
    try:
        name, encoded = value[len(PREFIX):].split(':', 1)
        payload = base64.urlsafe_b64decode(encoded)
        return AESGCM(keyring()[name]).decrypt(payload[:12], payload[12:], f'omnivoice:v1:{name}:{purpose}'.encode()).decode()
    except Exception as exc:
        raise ValueError('Encrypted data could not be authenticated. Check the keyring; data was not returned.') from exc


class SecureText(TypeDecorator):
    impl = Text
    cache_ok = True
    def __init__(self, purpose):
        self.purpose = purpose
        super().__init__()
    def process_bind_param(self, value, dialect):
        return seal(value, self.purpose)
    def process_result_value(self, value, dialect):
        return unseal(value, self.purpose)


class SecureJSON(TypeDecorator):
    impl = JSON
    cache_ok = True
    def __init__(self, purpose):
        self.purpose = purpose
        super().__init__()
    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not get_settings().data_encryption_active_key:
            if get_settings().production_mode:
                raise ValueError('Data encryption is required in production.')
            return value
        return {'__omnivoice_encrypted_v1': seal(json.dumps(value, ensure_ascii=False), self.purpose)}
    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, dict) and set(value) == {'__omnivoice_encrypted_v1'}:
            return json.loads(unseal(value['__omnivoice_encrypted_v1'], self.purpose))
        if not get_settings().allow_legacy_plaintext_reads:
            raise ValueError('Unencrypted legacy JSON requires migration.')
        return value
