from app.config import settings

import json
import time
import jwt
import requests
from pathlib import Path


class EnableBankingClient:
    BASE_URL = "https://api.enablebanking.com"

    def __init__(self):
        self.app_id = settings.enable_banking_app_id
        self._private_key = None

    @property
    def private_key(self) -> str:
        if self._private_key is None:
            key_path = Path(settings.private_key_path)
            if not key_path.exists():
                raise FileNotFoundError(
                    f"Private key not found at {key_path}. "
                    "Place your Enable Banking .pem file there."
                )
            self._private_key = key_path.read_text()
        return self._private_key

    def _generate_jwt(self) -> str:
        """Generate a signed JWT for Enable Banking API authentication."""
        now = int(time.time())
        payload = {
            "iss": self.app_id,
            "aud": self.BASE_URL,
            "iat": now,
            "exp": now + 3600,
        }
        return jwt.encode(payload, self.private_key, algorithm="RS256")

    def _headers(self) -> dict:
        token = self._generate_jwt()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def list_banks(self) -> list:
        """Get list of supported banks (ASPSPs)."""
        resp = requests.get(f"{self.BASE_URL}/api/aspsps", headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    def initiate_auth(self, aspsp_id: str, redirect_url: str) -> dict:
        """Start OAuth flow: user gets redirected to their bank."""
        payload = {
            "aspsp": aspsp_id,
            "redirect_uri": redirect_url,
            "psu_type": "personal",
            "scope": "aisp",
        }
        resp = requests.post(
            f"{self.BASE_URL}/api/authorisation",
            headers=self._headers(),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

    def get_accounts(self, auth_token: str) -> list:
        """Fetch accounts using an active auth token."""
        resp = requests.get(
            f"{self.BASE_URL}/api/accounts",
            headers={**self._headers(), "Authorization": f"Bearer {auth_token}"},
        )
        resp.raise_for_status()
        return resp.json()

    def get_transactions(
        self, auth_token: str, account_id: str, date_from: str = None
    ) -> list:
        """Fetch transactions for a specific account."""
        params = {}
        if date_from:
            params["date_from"] = date_from
        resp = requests.get(
            f"{self.BASE_URL}/api/accounts/{account_id}/transactions",
            headers={**self._headers(), "Authorization": f"Bearer {auth_token}"},
            params=params,
        )
        resp.raise_for_status()
        return resp.json()
