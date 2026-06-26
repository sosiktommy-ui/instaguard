from instagrapi import Client
import base64
import json
import logging
import urllib.parse

logger = logging.getLogger(__name__)


def _parse_mobile_session(raw: str) -> dict:
    """
    Parse the pipe-delimited Android Instagram session export format:
      username:id:token | UserAgent | device_id;uuid;phone_id;adid | Key=Val;Key=Val; | |
    Returns instagrapi-compatible settings dict.
    """
    parts = raw.split('|')

    user_agent = parts[1].strip() if len(parts) > 1 else ''

    # Device IDs (part 3): "android-XXXX;uuid;phone_id;adid"
    device_ids = [d.strip() for d in parts[2].split(';')] if len(parts) > 2 else []
    raw_device_id = device_ids[0] if device_ids else ''
    device_id     = raw_device_id.replace('android-', '')
    uuid          = device_ids[1] if len(device_ids) > 1 else ''
    phone_id      = device_ids[2] if len(device_ids) > 2 else ''
    adid          = device_ids[3] if len(device_ids) > 3 else ''

    # Headers (part 4): "Key=Value;Key=Value;..."
    headers: dict[str, str] = {}
    if len(parts) > 3:
        for item in parts[3].split(';'):
            item = item.strip()
            if '=' in item:
                k, _, v = item.partition('=')
                headers[k.strip()] = v.strip()

    # Decode Bearer IGT:2:<base64> → {"ds_user_id": "...", "sessionid": "..."}
    auth       = headers.get('Authorization', '')
    session_id = ''
    ds_user_id = headers.get('IG-U-DS-USER-ID', '')

    if 'IGT:2:' in auth:
        b64 = auth.split('IGT:2:')[1]
        b64 += '=' * ((4 - len(b64) % 4) % 4)
        try:
            decoded    = json.loads(base64.b64decode(b64).decode('utf-8'))
            session_id = urllib.parse.unquote(decoded.get('sessionid', ''))
            if not ds_user_id:
                ds_user_id = decoded.get('ds_user_id', '')
        except Exception as e:
            logger.warning("Bearer decode failed: %s", e)

    logger.info("Mobile session parsed: user_id=%s session_id=%s...", ds_user_id, session_id[:20])

    return {
        "cookies": {
            "sessionid": session_id,
            "ds_user_id": ds_user_id,
        },
        "user_agent": user_agent,
        "device_settings": {
            "device_id":         device_id,
            "uuid":              uuid,
            "phone_id":          phone_id,
            "android_device_id": raw_device_id,
            "advertising_id":    adid,
        },
        "authorization_data": {
            "ds_user_id": ds_user_id,
            "sessionid":  session_id,
        },
    }


def _is_mobile_session(cookies: dict) -> bool:
    """Detect pipe-delimited Android session pasted as {"sessionid": "<raw>"}."""
    raw = cookies.get('sessionid', '')
    return isinstance(raw, str) and '|' in raw and 'Authorization=Bearer' in raw


def build_client(session_data: dict, proxy: str | None = None) -> Client:
    cl = Client()
    if proxy:
        cl.set_proxy(proxy)
    cl.set_settings(session_data)
    cl.get_timeline_feed()
    return cl


def login_by_credentials(username: str, password: str, proxy: str | None = None) -> dict:
    cl = Client()
    if proxy:
        cl.set_proxy(proxy)
    cl.login(username, password)
    return cl.get_settings()


def login_by_cookies(cookies: dict, proxy: str | None = None) -> tuple[dict, str]:
    cl = Client()
    if proxy:
        cl.set_proxy(proxy)

    if _is_mobile_session(cookies):
        # Pipe-delimited Android session export — parse and reconstruct proper settings
        settings = _parse_mobile_session(cookies['sessionid'])
        cl.set_settings(settings)
    else:
        # Plain cookie dict (sessionid, csrftoken, …) or single sessionid value
        cl.private.cookies.update(cookies)

    cl.get_timeline_feed()
    info = cl.account_info()
    return cl.get_settings(), info.username


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
