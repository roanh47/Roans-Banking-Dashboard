from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from app.enable_banking import EnableBankingClient
from app.database import get_db
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/banks")
def list_banks():
    """Get supported banks for the user to choose from."""
    client = EnableBankingClient()
    try:
        banks = client.list_banks()
        return {"banks": banks.get("aspsps", banks) if isinstance(banks, dict) else banks}
    except Exception as e:
        return {"error": str(e)}


@router.get("/connect/{bank_id}")
def connect_bank(bank_id: str, request: Request):
    """Redirect user to their bank's login page."""
    client = EnableBankingClient()
    redirect_uri = str(request.base_url).rstrip("/") + "/api/auth/callback"
    result = client.initiate_auth(bank_id, redirect_uri)
    auth_url = result.get("url") or result.get("redirect_url")
    return RedirectResponse(url=auth_url)


@router.get("/callback")
def auth_callback(request: Request, code: str = None, error: str = None):
    """Handle the OAuth callback from the bank."""
    if error:
        return {"error": f"Bank authorization failed: {error}"}

    # The code/token comes back - for now store it
    # In a real scenario, Enable Banking returns an auth token
    # that we exchange for account access
    return RedirectResponse(url=f"/?connected=true")
