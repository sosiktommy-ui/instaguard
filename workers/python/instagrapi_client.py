from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ChallengeRequired, UserNotFound
import json
import logging

logger = logging.getLogger(__name__)


def build_client(session_data: dict, proxy: str | None = None) -> Client:
    cl = Client()
    if proxy:
        cl.set_proxy(proxy)
    cl.set_settings(session_data)
    cl.get_timeline_feed()  # проверяем что сессия живая
    return cl


def login_by_credentials(username: str, password: str, proxy: str | None = None) -> dict:
    cl = Client()
    if proxy:
        cl.set_proxy(proxy)
    cl.login(username, password)
    return cl.get_settings()


def get_followers(session_data: dict, username: str, proxy: str | None = None, amount: int = 0) -> list[dict]:
    cl = build_client(session_data, proxy)
    user_id = cl.user_id_from_username(username)
    followers = cl.user_followers(user_id, amount=amount)
    return [
        {"pk": str(u.pk), "username": u.username, "full_name": u.full_name}
        for u in followers.values()
    ]


def send_direct_message(session_data: dict, to_user_id: str, text: str, proxy: str | None = None) -> dict:
    cl = build_client(session_data, proxy)
    thread = cl.direct_send(text, [int(to_user_id)])
    return {"thread_id": str(thread.id), "status": "sent"}
