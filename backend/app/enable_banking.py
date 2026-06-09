from app.config import settings

import time
import uuid
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

    def _make_jwt(self) -> str:
        """Generate a signed JWT for app-level API authentication."""
        now = int(time.time())
        payload = {
            "iss": "enablebanking.com",
            "aud": "api.enablebanking.com",
            "iat": now,
            "exp": now + 3600,
        }
        return jwt.encode(payload, self.private_key, algorithm="RS256", headers={"kid": self.app_id})

    def _headers(self) -> dict:
        """Headers with app-level JWT Bearer auth (used for ALL API calls)."""
        return {
            "Authorization": f"Bearer {self._make_jwt()}",
            "Content-Type": "application/json",
        }

    # --- Bank discovery ---

    def list_banks(self) -> list:
        """Get list of supported banks (ASPSPs)."""
        resp = requests.get(f"{self.BASE_URL}/aspsps", headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    # --- OAuth flow ---

    def initiate_auth(self, aspsp_name: str, aspsp_country: str, redirect_url: str, state: str = None) -> dict:
        """Start OAuth flow. Returns dict with 'url' (redirect user here) and 'state'."""
        import datetime

        if state is None:
            state = str(uuid.uuid4())

        valid_until = (
            datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(days=180)
        ).isoformat().replace("+00:00", "Z")

        payload = {
            "aspsp": {"name": aspsp_name, "country": aspsp_country},
            "redirect_url": redirect_url,
            "psu_type": "personal",
            "access": {"valid_until": valid_until},
            "state": state,
        }
        resp = requests.post(
            f"{self.BASE_URL}/auth",
            headers=self._headers(),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        data["state"] = state
        return data

    def exchange_code(self, code: str) -> dict:
        """Exchange the OAuth code for a session.

        POST /sessions with the code. Returns session_id + accounts.
        """
        resp = requests.post(
            f"{self.BASE_URL}/sessions",
            headers=self._headers(),
            json={"code": code},
        )
        resp.raise_for_status()
        return resp.json()

    # --- Session / account data ---

    def get_session(self, session_id: str) -> dict:
        """Get session details (includes accounts and balances)."""
        resp = requests.get(
            f"{self.BASE_URL}/sessions/{session_id}",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def get_accounts(self, session_id: str) -> list:
        """Fetch accounts for a session. Uses app JWT + session_id."""
        data = self.get_session(session_id)
        return data.get("accounts", [])

    def get_transactions(
        self, account_id: str, date_from: str = None, date_to: str = None,
    ) -> dict:
        """Fetch transactions for a specific account. Uses app JWT."""
        params = {}
        if date_from:
            params["date_from"] = date_from
        if date_to:
            params["date_to"] = date_to

        resp = requests.get(
            f"{self.BASE_URL}/accounts/{account_id}/transactions",
            headers=self._headers(),
            params=params,
        )
        resp.raise_for_status()
        return resp.json()
