import os
import base64
import json
import logging
import urllib.parse

from instagrapi import Client
from instagrapi.exceptions import ChallengeRequired

logger = logging.getLogger(__name__)

TWOCAPTCHA_KEY = os.getenv('TWOCAPTCHA_API_KEY', '')


def _normalize_proxy(proxy: str | None) -> str | None:
    """Normalize proxy to http://user:pass@host:port regardless of input format."""
    if not proxy:
        return None
    proxy = proxy.strip()
    if proxy.startswith(('http://', 'https://', 'socks5://', 'socks4://')):
        return proxy
    # user:pass@host:port  →  http://user:pass@host:port
    if '@' in proxy:
        return f'http://{proxy}'
    # host:port:user:pass  →  http://user:pass@host:port
    parts = proxy.split(':')
    if len(parts) == 4:
        host, port, user, password = parts
        return f'http://{user}:{password}@{host}:{port}'
    # host:port  →  http://host:port
    return f'http://{proxy}'

# In-memory store for pending challenge sessions: username → {settings, api_path, proxy}
_challenge_sessions: dict[str, dict] = {}

# Instagram reCAPTCHA site key (used in challenge pages)
_IG_RECAPTCHA_SITEKEY = '6LenUD0UAAAAABGHhh5oqMVnHlC2tDHWwHkM79Nl'


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
        cl.set_proxy(_normalize_proxy(proxy))
    cl.set_settings(session_data)
    cl.get_timeline_feed()
    return cl


def _try_solve_recaptcha(page_url: str = 'https://www.instagram.com/challenge/') -> str | None:
    """Try to solve Instagram reCAPTCHA via 2captcha. Returns the g-recaptcha-response token or None."""
    if not TWOCAPTCHA_KEY:
        return None
    try:
        from twocaptcha import TwoCaptcha
        solver = TwoCaptcha(TWOCAPTCHA_KEY)
        result = solver.recaptcha(sitekey=_IG_RECAPTCHA_SITEKEY, url=page_url)
        token = result.get('code', '')
        logger.info("2captcha solved reCAPTCHA, token=%s...", token[:20])
        return token
    except Exception as e:
        logger.warning("2captcha solve failed: %s", e)
        return None


def login_by_credentials(username: str, password: str, proxy: str | None = None) -> dict:
    """
    Returns {'sessionData': dict} on success.
    Returns {'needsChallenge': True, 'stepName': str, 'username': str} when challenge is required
    (challenge session stored internally — call submit_challenge_code next).
    Raises Exception on hard failure.
    """
    cl = Client()
    if proxy:
        cl.set_proxy(_normalize_proxy(proxy))

    try:
        cl.login(username, password)
        return {'sessionData': cl.get_settings()}

    except ChallengeRequired:
        challenge = cl.last_json.get('challenge', {})
        api_path = challenge.get('api_path', '')

        if not api_path:
            raise Exception("Требуется подтверждение Instagram. Войдите вручную в приложение.")

        # Fetch challenge info
        try:
            resp = cl.private.get(f'https://i.instagram.com{api_path}?next=%2F')
            challenge_data = resp.json()
        except Exception as e:
            raise Exception(f"ChallengeRequired: не удалось получить тип challenge ({e})")

        step_name = challenge_data.get('step_name', '')
        logger.info("Challenge step=%s for @%s api_path=%s", step_name, username, api_path)

        # Try automatic resolution depending on step type
        if step_name == 'delta_login_review':
            # "Was this you?" — confirm "it was me"
            try:
                confirm = cl.private.post(
                    f'https://i.instagram.com{api_path}',
                    data={'choice': '0'}
                ).json()
                if confirm.get('action') == 'close' or confirm.get('status') == 'ok':
                    cl.get_timeline_feed()
                    logger.info("delta_login_review confirmed, login complete for @%s", username)
                    return {'sessionData': cl.get_settings()}
                step_name = confirm.get('step_name', step_name)
            except Exception as e:
                logger.warning("delta_login_review confirm failed: %s", e)

        if step_name in ('recaptcha', 'captcha'):
            # Try to solve with 2captcha
            token = _try_solve_recaptcha()
            if token:
                try:
                    solve_resp = cl.private.post(
                        f'https://i.instagram.com{api_path}',
                        data={'g-recaptcha-response': token}
                    ).json()
                    if solve_resp.get('action') == 'close' or solve_resp.get('status') == 'ok':
                        cl.get_timeline_feed()
                        return {'sessionData': cl.get_settings()}
                    step_name = solve_resp.get('step_name', step_name)
                    logger.info("After captcha solve, step=%s", step_name)
                except Exception as e:
                    logger.warning("Captcha submit failed: %s", e)

        if step_name == 'select_verify_method':
            # Trigger code send to email (choice=1)
            try:
                send_resp = cl.private.post(
                    f'https://i.instagram.com{api_path}',
                    data={'choice': '1'}
                ).json()
                step_name = send_resp.get('step_name', step_name)
                logger.info("Email code requested, next step=%s", step_name)
            except Exception as e:
                logger.warning("Could not request email code: %s", e)

        # Store challenge session so submit_challenge_code can continue
        _challenge_sessions[username] = {
            'settings': cl.get_settings(),
            'api_path': api_path,
            'proxy': proxy,
        }

        return {'needsChallenge': True, 'stepName': step_name, 'username': username}


def submit_challenge_code(username: str, code: str) -> dict:
    """Submit the verification code received by email/SMS. Returns {'sessionData': dict}."""
    pending = _challenge_sessions.get(username)
    if not pending:
        raise Exception("Нет активного challenge. Начните авторизацию заново.")

    cl = Client()
    if pending.get('proxy'):
        cl.set_proxy(pending['proxy'])
    cl.set_settings(pending['settings'])

    api_path = pending['api_path']

    try:
        resp = cl.private.post(
            f'https://i.instagram.com{api_path}',
            data={'security_code': code}
        )
        resp_data = resp.json()
        logger.info("Challenge code submit response: %s", resp_data)

        status = resp_data.get('status', '')
        action = resp_data.get('action', '')

        if status == 'ok' or action == 'close':
            cl.get_timeline_feed()
            del _challenge_sessions[username]
            return {'sessionData': cl.get_settings()}

        msg = resp_data.get('message', str(resp_data))
        raise Exception(f"Неверный код подтверждения: {msg}")

    except Exception as e:
        raise Exception(f"Ошибка подтверждения: {e}")


def login_by_cookies(cookies: dict, proxy: str | None = None) -> tuple[dict, str]:
    cl = Client()
    if proxy:
        cl.set_proxy(_normalize_proxy(proxy))

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


def get_followers(session_data: dict, username: str, proxy: str | None = None, amount: int = 50) -> list[dict]:
    cl = build_client(session_data, proxy)
    user_id = cl.user_id_from_username(username)
    followers = cl.user_followers(user_id, amount=amount)
    result = [
        {"pk": str(u.pk), "username": u.username, "full_name": u.full_name}
        for u in followers.values()
    ]
    logger.info("get_followers: @%s → %d followers (amount=%d)", username, len(result), amount)
    return result


def send_direct_message(session_data: dict, to_user_id: str, text: str, proxy: str | None = None) -> dict:
    cl = build_client(session_data, proxy)
    thread = cl.direct_send(text, [int(to_user_id)])
    return {"thread_id": str(thread.id), "status": "sent"}


def follow_user(session_data: dict, user_id: str, proxy: str | None = None) -> dict:
    """Подписаться в ответ на пользователя по его pk."""
    cl = build_client(session_data, proxy)
    ok = cl.user_follow(int(user_id))
    return {"status": "followed" if ok else "noop"}


def like_latest_media(session_data: dict, user_id: str, proxy: str | None = None) -> dict:
    """Лайкнуть последний пост пользователя по его pk."""
    cl = build_client(session_data, proxy)
    medias = cl.user_medias(int(user_id), amount=1)
    if not medias:
        return {"status": "no_media"}
    cl.media_like(medias[0].id)
    return {"status": "liked", "media_id": str(medias[0].id)}


def send_direct_photo(session_data: dict, to_user_id: str, image_b64: str, proxy: str | None = None) -> dict:
    """Отправить фото в директ. image_b64 — data-URL или чистый base64."""
    import tempfile, os
    cl = build_client(session_data, proxy)
    raw = image_b64.split(',', 1)[1] if image_b64.startswith('data:') else image_b64
    data = base64.b64decode(raw)
    tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        thread = cl.direct_send_photo(tmp.name, [int(to_user_id)])
        return {"thread_id": str(thread.id), "status": "sent"}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
