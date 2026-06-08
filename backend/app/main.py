from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from app.database import init_db
from app.routers import auth, accounts, transactions, insights

app = FastAPI(title="Roan's Banking Dashboard")

# Initialize database
init_db()

# API routers
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(insights.router)

# Serve frontend static files
static_dir = Path("/app/static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="frontend")


@app.on_event("startup")
async def startup():
    """Ensure database is ready on startup."""
    init_db()
