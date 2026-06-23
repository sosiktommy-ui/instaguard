import os
import logging
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import instagrapi_client as ig

load_dotenv()

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="InstaGuard Python Worker")

WORKER_SECRET = os.getenv("WORKER_SECRET", "")


def _check_secret(x_worker_secret: str):
    if WORKER_SECRET and x_worker_secret != WORKER_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


class SessionPayload(BaseModel):
    sessionData: dict
    proxy: str | None = None


class LoginPayload(BaseModel):
    username: str
    password: str
    proxy: str | None = None


class FollowersPayload(BaseModel):
    sessionData: dict
    username: str
    proxy: str | None = None


class DMPayload(BaseModel):
    sessionData: dict
    toUserId: str
    text: str
    proxy: str | None = None


@app.post("/test-session")
def test_session(payload: SessionPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        ig.build_client(payload.sessionData, payload.proxy)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/login")
def login(payload: LoginPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        settings = ig.login_by_credentials(payload.username, payload.password, payload.proxy)
        return {"sessionData": settings}
    except Exception as e:
        err = str(e)
        if "bad_password" in err or "password" in err.lower():
            detail = "Неверный пароль"
        elif "two_factor" in err or "2fa" in err.lower():
            detail = "Требуется двухфакторная аутентификация (2FA)"
        elif "challenge_required" in err or "challenge" in err.lower():
            detail = "Instagram требует подтверждение личности (challenge). Войдите вручную через приложение."
        elif "feedback_required" in err:
            detail = "Аккаунт временно заблокирован Instagram"
        elif "user_not_found" in err or "not found" in err.lower():
            detail = "Аккаунт не найден"
        elif "rate" in err.lower() or "spam" in err.lower():
            detail = "Слишком много запросов — подождите и попробуйте снова"
        else:
            detail = f"Ошибка Instagram: {err}"
        logging.warning("Login failed for %s: %s", payload.username, err)
        raise HTTPException(status_code=400, detail=detail)


@app.post("/followers")
def followers(payload: FollowersPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        result = ig.get_followers(payload.sessionData, payload.username, payload.proxy)
        return {"followers": result}
    except Exception as e:
        logging.error("get_followers error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/send-dm")
def send_dm(payload: DMPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        result = ig.send_direct_message(payload.sessionData, payload.toUserId, payload.text, payload.proxy)
        return result
    except Exception as e:
        logging.error("send_dm error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
