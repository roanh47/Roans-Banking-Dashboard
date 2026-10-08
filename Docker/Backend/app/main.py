from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import init_db
from app.routers import (
    accounts,
    ai,
    auth,
    chat,
    external,
    insights,
    recategorize,
    sync,
    transactions,
)

app = FastAPI(title="Banking Dashboard", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(sync.router)
app.include_router(transactions.router)
app.include_router(insights.router)
app.include_router(external.router)
app.include_router(ai.router)
app.include_router(chat.router)
app.include_router(recategorize.router)

app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
