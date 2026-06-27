import os
import logging
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
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
    amount: int = 50


class DMPayload(BaseModel):
    sessionData: dict
    toUserId: str
    text: str
    proxy: str | None = None


class CookiePayload(BaseModel):
    cookies: dict
    proxy: str | None = None


class ActionPayload(BaseModel):
    sessionData: dict
    userId: str
    proxy: str | None = None


class PhotoPayload(BaseModel):
    sessionData: dict
    toUserId: str
    image: str
    proxy: str | None = None


class ChallengeCodePayload(BaseModel):
    username: str
    code: str


@app.post("/login-cookies")
def login_cookies(payload: CookiePayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        settings, username = ig.login_by_cookies(payload.cookies, payload.proxy)
        return {"sessionData": settings, "username": username}
    except Exception as e:
        err_type = type(e).__name__
        err = str(e)
        logging.warning("Cookie login failed [%s]: %s", err_type, err)
        if err_type in ("LoginRequired", "ChallengeRequired"):
            detail = "Куки недействительны или истекли — экспортируйте свежие куки из браузера."
        elif err_type == "SentryBlock":
            detail = "Instagram заблокировал вход с этого IP. Попробуйте через прокси."
        else:
            detail = f"{err_type}: {err}"
        raise HTTPException(status_code=400, detail=detail)


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
        result = ig.login_by_credentials(payload.username, payload.password, payload.proxy)
        if result.get('needsChallenge'):
            # 202 = challenge required, not an error
            return JSONResponse(status_code=202, content=result)
        return result
    except Exception as e:
        err_type = type(e).__name__
        err = str(e)
        logging.warning("Login failed for %s [%s]: %s", payload.username, err_type, err)

        if err_type in ("BadPassword", "IncorrectPassword"):
            detail = "Неверный пароль. Проверьте логин и пароль."
        elif err_type == "TwoFactorRequired":
            detail = "Требуется двухфакторная аутентификация (2FA) — отключите её временно в настройках Instagram."
        elif err_type in ("ChallengeRequired", "ChallengeUnknownStep", "SelectContactPointRecoveryForm"):
            detail = "Instagram требует подтверждение с нового устройства. Войдите вручную в приложение и подтвердите, затем попробуйте снова."
        elif err_type == "FeedbackRequired":
            detail = "Аккаунт временно ограничен Instagram (FeedbackRequired)."
        elif err_type == "SentryBlock":
            detail = "Instagram заблокировал вход с этого IP-адреса. Попробуйте через прокси."
        elif err_type == "PleaseWaitFewMinutes":
            detail = "Слишком много запросов — подождите несколько минут и попробуйте снова."
        elif err_type == "LoginRequired":
            detail = "Instagram не принял авторизацию. Попробуйте через несколько минут."
        else:
            detail = f"{err_type}: {err}"

        raise HTTPException(status_code=400, detail=detail)


@app.post("/login-challenge")
def login_challenge(payload: ChallengeCodePayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        result = ig.submit_challenge_code(payload.username, payload.code)
        return result
    except Exception as e:
        logging.warning("Challenge code failed for %s: %s", payload.username, e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/followers")
def followers(payload: FollowersPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        result = ig.get_followers(payload.sessionData, payload.username, payload.proxy, payload.amount)
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


@app.post("/follow-user")
def follow_user(payload: ActionPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        return ig.follow_user(payload.sessionData, payload.userId, payload.proxy)
    except Exception as e:
        logging.error("follow_user error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/like-latest-media")
def like_latest_media(payload: ActionPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        return ig.like_latest_media(payload.sessionData, payload.userId, payload.proxy)
    except Exception as e:
        logging.error("like_latest_media error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/send-dm-photo")
def send_dm_photo(payload: PhotoPayload, x_worker_secret: str = Header(...)):
    _check_secret(x_worker_secret)
    try:
        return ig.send_direct_photo(payload.sessionData, payload.toUserId, payload.image, payload.proxy)
    except Exception as e:
        logging.error("send_dm_photo error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
